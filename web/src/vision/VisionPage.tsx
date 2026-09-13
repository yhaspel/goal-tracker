import { type FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import type { GoalsIndex, VisionImage, VisionMutationResponse } from '../../../shared/api';
import { ApiError } from '../api/client';
import {
  deleteVisionImage,
  moveVisionImage,
  patchVisionImage,
  readGoalsIndex,
  readSession,
  uploadVisionImage,
  visionImageUrl
} from '../api/endpoints';
import { useSession } from '../auth/session';
import { ActionsMenu, type MenuEntry } from '../components/ActionsMenu';
import { errorText, fieldErrorText } from '../components/errors';
import { ChevronEndIcon, ChevronStartIcon, PlusIcon } from '../components/icons';
import { Alert, Dialog, Field, Submit, useAnnounce, WithValue } from '../components/ui';
import { useTranslation } from '../i18n';
import { prepareImage, TooLargeAfterEncodingError, UnreadableImageError } from './prepare';
import { useVision } from './useVision';

type FileStatus = 'queued' | 'preparing' | 'uploading' | 'done' | 'failed';
type FileOutcome = { key: string; name: string; status: FileStatus; reason?: string };

type EditForm = { image: VisionImage; caption: string; goalId: string };

export function VisionPage() {
  const translator = useTranslation();
  const { t, plural } = translator;
  const { state, forgetSession } = useSession();
  const announce = useAnnounce();
  const { vision, error, loading, refresh } = useVision(state.status === 'active', forgetSession);

  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<unknown>(null);
  const [openAt, setOpenAt] = useState<number | null>(null);
  const [editing, setEditing] = useState<EditForm | null>(null);
  const [deleting, setDeleting] = useState<VisionImage | null>(null);
  const [outcomes, setOutcomes] = useState<FileOutcome[]>([]);
  const [uploading, setUploading] = useState(false);
  const [goalsIndex, setGoalsIndex] = useState<GoalsIndex | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  /** The tile that opened the carousel, so focus goes back to it and not to the document. */
  const openedFrom = useRef<HTMLButtonElement | null>(null);

  // Fetched once on mount, and again after a link changes. Never polled: the list changes rarely
  // and a second 30 s poll would double this screen's Durable Object cost.
  const refreshGoalsIndex = useCallback(() => {
    void readGoalsIndex()
      .then(setGoalsIndex)
      .catch(() => setGoalsIndex(null));
  }, []);

  useEffect(() => {
    if (state.status !== 'active') return;
    refreshGoalsIndex();
  }, [state.status, refreshGoalsIndex]);

  const runMutation = useCallback(
    async (call: (revision: number) => Promise<VisionMutationResponse>, announceOnSuccess?: string) => {
      if (!vision || pending) return false;
      setPending(true);
      setFailure(null);
      try {
        await call(vision.visionRevision);
        await refresh();
        if (announceOnSuccess) announce(announceOnSuccess);
        return true;
      } catch (cause) {
        setFailure(cause);
        if (cause instanceof ApiError && cause.status === 401) {
          forgetSession();
          return false;
        }
        if (cause instanceof ApiError && cause.code === 'revision_conflict') await refresh();
        return false;
      } finally {
        setPending(false);
      }
    },
    [vision, pending, refresh, announce, forgetSession]
  );

  /**
   * One file at a time, with a per-file outcome.
   *
   * The status is carried by `aria-busy` and the existing `.busy-dots` contract rather than by a
   * progress bar: the single API client is `fetch`-based, `fetch` cannot report upload progress,
   * and a second HTTP path would bypass `apiRequest`'s CSRF header, credentials, cache mode and
   * error envelope — exactly the drift that one client exists to prevent.
   */
  const addFiles = useCallback(
    async (files: FileList) => {
      const chosen = Array.from({ length: files.length }, (_, index) => files[index]!);
      if (chosen.length === 0) return;
      setUploading(true);
      setFailure(null);
      setOutcomes(chosen.map((file, index) => ({ key: `${index}-${file.name}`, name: file.name, status: 'queued' })));

      const update = (key: string, status: FileStatus, reason?: string) =>
        setOutcomes(current => current.map(entry => (entry.key === key ? { ...entry, status, reason } : entry)));

      let added = 0;
      for (const [index, file] of chosen.entries()) {
        const key = `${index}-${file.name}`;
        update(key, 'preparing');
        try {
          const prepared = await prepareImage(file);
          update(key, 'uploading');
          // Read fresh each time: the revision advanced with the file before this one.
          const current = await refresh();
          if (!current) throw new ApiError(0, 'network', 'no snapshot');
          await uploadVisionImage({ visionRevision: current.visionRevision, ...prepared });
          update(key, 'done');
          added += 1;
        } catch (cause) {
          if (cause instanceof UnreadableImageError) {
            update(key, 'failed', t('vision.fileUnreadable'));
          } else if (cause instanceof TooLargeAfterEncodingError) {
            update(key, 'failed', t('error.image_too_large'));
          } else {
            update(key, 'failed', errorText(translator, cause));
            if (cause instanceof ApiError && cause.status === 401) {
              forgetSession();
              break;
            }
          }
        }
      }

      await refresh();
      setUploading(false);
      if (added > 0) announce(t('vision.added'));
    },
    [refresh, announce, t, translator, forgetSession]
  );

  const images = vision?.images ?? [];

  if (error) {
    return (
      <section className="panel">
        <h1>{t('vision.heading')}</h1>
        <Alert tone="error">{errorText(translator, error)}</Alert>
        <button type="button" onClick={() => void refresh()}>
          {t('vision.reload')}
        </button>
      </section>
    );
  }

  if (loading || !vision) {
    return (
      <div className="vision-page">
        <div className="board-header">
          <h1>{t('vision.heading')}</h1>
          <p className="board-count">{t('app.loading')}</p>
        </div>
        <div className="skeleton-gallery" aria-hidden="true">
          {[0, 1, 2, 3].map(index => (
            <div className="skeleton-tile" key={index} />
          ))}
        </div>
      </div>
    );
  }

  const submitEdit = (event: FormEvent) => {
    event.preventDefault();
    if (!editing || pending) return;
    const caption = editing.caption.length > 0 ? editing.caption : null;
    const goalId = editing.goalId.length > 0 ? editing.goalId : null;
    void runMutation(
      revision => patchVisionImage(editing.image.id, { visionRevision: revision, caption, goalId }),
      t('vision.saved')
    ).then(saved => {
      if (saved) setEditing(null);
    });
  };

  return (
    <div className="vision-page">
      <div className="board-header">
        <h1>{t('vision.heading')}</h1>
        <p className="board-count">{plural('vision.imageCount', images.length)}</p>
        {/*
         * A visually hidden `<input type="file">` labelled by a real button. A bare file input
         * renders browser-supplied text in the *browser's* language rather than the app's, and
         * cannot be styled to the 44px target.
         */}
        <button type="button" onClick={() => fileInput.current?.click()} disabled={pending || uploading}>
          <PlusIcon />
          {t('vision.addImages')}
        </button>
        <input
          ref={fileInput}
          className="visually-hidden"
          type="file"
          accept="image/jpeg,image/png,image/webp"
          multiple
          tabIndex={-1}
          aria-hidden="true"
          onChange={event => {
            const files = event.target.files;
            if (files) void addFiles(files);
            // Cleared so choosing the same file twice in a row still fires a change.
            event.target.value = '';
          }}
        />
      </div>

      <p className="help">{t('vision.addHelp')}</p>
      {failure ? <Alert tone="error">{errorText(translator, failure)}</Alert> : null}

      {outcomes.length > 0 ? (
        <section className="upload-list" aria-busy={uploading}>
          <h2>{t('vision.uploadHeading')}</h2>
          <ul role="list">
            {outcomes.map(outcome => (
              <li key={outcome.key}>
                <span dir="auto">{outcome.name}</span>
                <span className={outcome.status === 'failed' ? 'error' : 'help'}>
                  {outcome.reason ??
                    t(
                      outcome.status === 'queued'
                        ? 'vision.fileQueued'
                        : outcome.status === 'preparing'
                          ? 'vision.filePreparing'
                          : outcome.status === 'uploading'
                            ? 'vision.fileUploading'
                            : outcome.status === 'done'
                              ? 'vision.fileDone'
                              : 'vision.fileFailed'
                    )}
                </span>
                {outcome.status === 'preparing' || outcome.status === 'uploading' ? (
                  <span className="busy-dots" aria-hidden="true">
                    <i />
                    <i />
                    <i />
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {images.length === 0 ? <p className="help">{t('vision.empty')}</p> : null}

      <ul className="gallery" role="list">
        {images.map((image, index) => (
          <Tile
            key={image.id}
            image={image}
            index={index}
            total={images.length}
            pending={pending}
            onOpen={element => {
              openedFrom.current = element;
              setOpenAt(index);
            }}
            onEdit={() => setEditing({ image, caption: image.caption ?? '', goalId: image.goalId ?? '' })}
            onDelete={() => setDeleting(image)}
            onMove={target =>
              void runMutation(
                revision => moveVisionImage(image.id, { visionRevision: revision, targetIndex: target }),
                t('vision.moved', { position: target + 1 })
              )
            }
            onSessionLost={forgetSession}
          />
        ))}
      </ul>

      {openAt !== null && images[openAt] ? (
        <Carousel
          images={images}
          at={openAt}
          goalsIndex={goalsIndex}
          onStep={next => setOpenAt(next)}
          onClose={() => {
            setOpenAt(null);
            // Focus returns to the tile the carousel was entered from.
            window.setTimeout(() => openedFrom.current?.focus(), 0);
          }}
        />
      ) : null}

      {editing ? (
        <Dialog title={t('vision.editHeading')} onClose={() => setEditing(null)}>
          {failure ? <Alert tone="error">{errorText(translator, failure)}</Alert> : null}
          <form onSubmit={submitEdit} noValidate>
            <Field
              label={`${t('vision.caption')} (${t('app.optional')})`}
              value={editing.caption}
              onChange={caption => setEditing({ ...editing, caption })}
              error={fieldErrorText(translator, failure, 'caption')}
              autoComplete="off"
              autoDir
            />
            {goalsIndex ? (
              <p className="field">
                <label htmlFor="image-goal">{t('vision.goalLink')}</label>
                <select
                  id="image-goal"
                  value={editing.goalId}
                  onChange={event => setEditing({ ...editing, goalId: event.target.value })}
                >
                  <option value="">{t('vision.goalNone')}</option>
                  {goalsIndex.goals.map(goal => (
                    <option key={goal.id} value={goal.id}>
                      {t('goals.optgroupLabel', { title: goal.title, year: goal.year })}
                    </option>
                  ))}
                  {editing.goalId.length > 0 && !goalsIndex.goals.some(goal => goal.id === editing.goalId) ? (
                    <option value={editing.goalId}>{t('card.partOfUnknown')}</option>
                  ) : null}
                </select>
                {fieldErrorText(translator, failure, 'goalId') ? (
                  <span className="error">{fieldErrorText(translator, failure, 'goalId')}</span>
                ) : null}
              </p>
            ) : null}
            <div className="dialog-footer">
              <button type="button" onClick={() => setEditing(null)}>
                {t('app.cancel')}
              </button>
              <Submit pending={pending}>{t('app.save')}</Submit>
            </div>
          </form>
        </Dialog>
      ) : null}

      {deleting ? (
        <Dialog
          title={t('app.delete')}
          onClose={() => setDeleting(null)}
          footer={
            <>
              <button type="button" onClick={() => setDeleting(null)}>
                {t('app.cancel')}
              </button>
              <button
                type="button"
                className="danger"
                onClick={() => {
                  const image = deleting;
                  setDeleting(null);
                  void runMutation(
                    revision => deleteVisionImage(image.id, { visionRevision: revision }),
                    t('vision.deleted')
                  );
                }}
              >
                {t('app.delete')}
              </button>
            </>
          }
        >
          <p>{t('vision.deleteConfirm')}</p>
        </Dialog>
      ) : null}
    </div>
  );
}

function Tile({
  image,
  index,
  total,
  pending,
  onOpen,
  onEdit,
  onDelete,
  onMove,
  onSessionLost
}: {
  image: VisionImage;
  index: number;
  total: number;
  pending: boolean;
  onOpen: (element: HTMLButtonElement) => void;
  onEdit: () => void;
  onDelete: () => void;
  onMove: (targetIndex: number) => void;
  onSessionLost: () => void;
}) {
  const { t } = useTranslation();
  const button = useRef<HTMLButtonElement>(null);
  const [retried, setRetried] = useState(false);
  const [source, setSource] = useState(() => visionImageUrl(image.id, 'thumb'));

  const entries: MenuEntry[] = [
    { key: 'edit', label: t('app.edit'), disabled: pending, run: onEdit },
    { key: 'earlier', label: t('vision.moveEarlier'), disabled: pending || index === 0, run: () => onMove(index - 1) },
    {
      key: 'later',
      label: t('vision.moveLater'),
      disabled: pending || index === total - 1,
      run: () => onMove(index + 1)
    },
    { key: 'delete', label: t('app.delete'), disabled: pending, danger: true, run: onDelete }
  ];

  const label = image.caption === null ? t('vision.tileAt', { n: index + 1 }) : t('vision.tile', { caption: image.caption });

  return (
    <li className="tile" role="listitem">
      {/*
       * A `<button>` around the image: an image with a click handler is not focusable, and
       * keyboard entry to the carousel is a requirement rather than a nicety. `alt` is empty
       * because the caption below is adjacent visible text and the button is already named.
       */}
      <button
        type="button"
        className="tile-button"
        ref={button}
        aria-label={label}
        onClick={() => button.current && onOpen(button.current)}
      >
        <img
          src={source}
          alt=""
          loading="lazy"
          width={image.thumbWidth}
          height={image.thumbHeight}
          onError={() => {
            // An `<img>` has no path to `forgetSession` of its own, and a gallery of broken
            // images is not an acceptable way to learn that a session ended. One retry, then the
            // same session re-check `useBoard` performs on a 401.
            if (!retried) {
              setRetried(true);
              setSource(`${visionImageUrl(image.id, 'thumb')}&retry=1`);
              return;
            }
            void readSession().catch(cause => {
              if (cause instanceof ApiError && cause.status === 401) onSessionLost();
            });
          }}
        />
      </button>
      <div className="tile-foot">
        {image.caption === null ? (
          // A noun where a caption would be. The button next to it is what names the action.
          <span className="help">{t('vision.untitled', { n: index + 1 })}</span>
        ) : (
          <span className="tile-caption" dir="auto">
            {image.caption}
          </span>
        )}
        <ActionsMenu
          entries={entries}
          triggerLabel={t('vision.actions', { n: index + 1 })}
          menuLabel={t('vision.actions', { n: index + 1 })}
        />
      </div>
    </li>
  );
}

/**
 * The carousel is a `Dialog`, so the focus contract is the one already shipped: Tab is trapped,
 * Escape closes, focus returns to whatever opened it. There is **no autoplay**. Only the two
 * neighbouring images are preloaded.
 */
function Carousel({
  images,
  at,
  goalsIndex,
  onStep,
  onClose
}: {
  images: readonly VisionImage[];
  at: number;
  goalsIndex: GoalsIndex | null;
  onStep: (next: number) => void;
  onClose: () => void;
}) {
  const { t, dir } = useTranslation();
  const image = images[at]!;
  const goal = goalsIndex?.goals.find(entry => entry.id === image.goalId) ?? null;

  const step = (delta: number) => {
    const next = (at + delta + images.length) % images.length;
    onStep(next);
  };

  /**
   * The arrow keys are bound on the document rather than on the carousel element, the way the
   * phone header's Escape already is.
   *
   * `Dialog` moves focus to the first field or else the first focusable control, which here is
   * the Close button in the dialog's *header* — a sibling of the body the carousel renders into.
   * A handler on the carousel itself therefore never saw the key, and ← and → did nothing until
   * the member had tabbed onto Previous or Next.
   */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      const target = event.target;
      // Never steal an arrow key from a field that is using it to move a caret.
      if (target instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      event.preventDefault();
      // Mirrored for a right-to-left page, the way the pager's arrow keys already are.
      const forward = event.key === 'ArrowRight' ? 1 : -1;
      step(dir === 'rtl' ? -forward : forward);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  });

  return (
    <Dialog title={t('vision.carousel')} onClose={onClose} size="wide">
      <div className="carousel">
        <img
          className="carousel-image"
          key={image.id}
          src={visionImageUrl(image.id, 'full')}
          alt=""
          width={image.width}
          height={image.height}
          style={{ aspectRatio: `${image.width} / ${image.height}` }}
        />

        {/* Only the neighbours, so a sixty-image gallery does not fetch sixty full images. */}
        {[-1, 1].map(offset => {
          const neighbour = images[(at + offset + images.length) % images.length];
          return neighbour && neighbour.id !== image.id ? (
            <link key={`${neighbour.id}-${offset}`} rel="preload" as="image" href={visionImageUrl(neighbour.id, 'full')} />
          ) : null;
        })}

        {image.caption !== null ? (
          <p className="carousel-caption" dir="auto">
            {image.caption}
          </p>
        ) : null}
        {goal ? (
          <p className="help">
            <WithValue template={t('card.partOfBadge')} name="milestone">
              <span dir="auto">{goal.title}</span>
            </WithValue>
          </p>
        ) : null}

        <div className="carousel-controls">
          <button
            type="button"
            className="icon"
            aria-label={t('vision.previous')}
            disabled={images.length < 2}
            onClick={() => step(-1)}
          >
            <ChevronStartIcon />
          </button>
          {/*
           * The position counter is the static marker under `prefers-reduced-motion`, where the
           * image transition is removed: it belongs to the component and renders in both modes.
           */}
          <p className="carousel-position">{t('vision.position', { n: at + 1, total: images.length })}</p>
          <button
            type="button"
            className="icon"
            aria-label={t('vision.next')}
            disabled={images.length < 2}
            onClick={() => step(1)}
          >
            <ChevronEndIcon />
          </button>
        </div>
      </div>
    </Dialog>
  );
}
