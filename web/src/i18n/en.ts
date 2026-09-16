/**
 * English source dictionary. It defines the key set every other locale must match; Stage 6
 * adds `he.ts` and `ru.ts` plus the release check that compares key sets and interpolation
 * parameters.
 *
 * Interpolation uses `{name}` placeholders. Keys ending in a plural category (`.one`, `.two`,
 * `.few`, `.many`, `.other`) are selected through `Intl.PluralRules`; every plural family must
 * provide at least `.other`.
 */
export const en = {
  'app.name': 'Goal Tracker',
  'app.skipToContent': 'Skip to main content',
  'app.loading': 'Loading…',
  'app.retry': 'Try again',
  'app.cancel': 'Cancel',
  'app.save': 'Save',
  'app.close': 'Close',
  'app.delete': 'Delete',
  'app.edit': 'Edit',
  'app.confirm': 'Confirm',
  'app.copy': 'Copy',
  'app.copied': 'Copied',
  'app.required': 'Required',
  'app.optional': 'optional',
  'app.language': 'Language',
  'app.menu': 'Menu',
  'app.offline': 'You appear to be offline. Check your connection and try again.',

  'flow.step': 'Step {n} of {total}',

  'nav.board': 'Board',
  /* Kept to one short word in every locale: five links plus the language selector and the
     signed-in address already push the 834–1199 header onto a second row. */
  'nav.goals': 'Goals',
  'nav.vision': 'Vision',
  'nav.settings': 'Settings',
  'nav.account': 'Account',
  'nav.signIn': 'Sign in',
  'nav.join': 'Join with an invitation',
  'nav.signOut': 'Sign out',
  'nav.signedInAs': 'Signed in as {email}',

  'welcome.heading': 'A shared board for your household',
  'welcome.body': 'Sign in to see the board. To join, you need an invitation from the owner.',
  'welcome.bootstrapPrompt': 'No owner account exists yet. Set one up to get started.',
  'welcome.bootstrapAction': 'Set up the owner account',

  'signIn.heading': 'Sign in',
  'signIn.email': 'Email address',
  'signIn.password': 'Password',
  'signIn.submit': 'Sign in',
  'signIn.forgot': 'Forgot your password?',
  'signIn.noEmail': 'This app never sends email, so there is no password reset link.',

  'bootstrap.heading': 'Set up the owner account',
  'bootstrap.body': 'The owner sets up this board once, without an invitation code. After signing in, the owner can allow email addresses and create invitations in Settings.',
  'bootstrap.secret': 'Setup secret',
  'bootstrap.secretHelp': 'Get this from the person who deployed the board. It is not an invitation code.',
  'bootstrap.closed': 'The owner account already exists. Sign in instead.',
  'bootstrap.submit': 'Continue',

  'register.heading': 'Join the board',
  'register.body': 'Enter the invitation code the owner gave you, along with the email address it was issued for.',
  'register.inviteHow': 'The owner adds your email address to the allowed list in Settings, creates a one-time invitation code there, and shares it with you directly. This app does not send email.',
  'register.ownerPrompt': 'Setting up a new group?',
  'register.code': 'Invitation code',
  'register.codeHelp': '32 characters, given to you by the owner.',
  'register.email': 'Email address',
  'register.password': 'Choose a password',
  'register.passwordHelp': 'At least 12 characters. Do not reuse a password from another site.',
  'register.submit': 'Continue',

  'phrase.heading': 'Save your recovery phrase',
  'phrase.body':
    'These 12 words are the only way back into your account if you forget your password. Write them down now and keep them somewhere safe.',
  'phrase.onceWarning': 'This is the only time it will be shown.',
  'phrase.noStorage': 'It is not saved in this browser, and nobody can look it up for you.',
  'phrase.confirmLabel': 'Type the phrase to confirm you saved it',
  'phrase.confirmHelp': 'Separate the words with spaces. Capitalization does not matter.',
  'phrase.submit': 'Confirm and finish',
  'phrase.abandonWarning': 'If you close this page before confirming, nothing changes and you will have to start again.',

  'recover.heading': 'Recover your account',
  'recover.withPhrase': 'I have my recovery phrase',
  'recover.withToken': 'The owner gave me a reset code',
  'recover.phraseBody': 'Enter your email address, your saved 12-word recovery phrase, and a new password.',
  'recover.tokenBody':
    'The owner can issue a one-time reset code after confirming who you are. Codes expire after 15 minutes.',
  'recover.phraseLabel': 'Recovery phrase',
  'recover.tokenLabel': 'Reset code',
  'recover.newPassword': 'New password',
  'recover.submit': 'Continue',
  'recover.lostBoth': 'Lost both your password and your phrase? Contact the owner directly. There is no email reset.',
  'recover.done': 'Your password and recovery phrase have been replaced. Sign in with your new password.',

  'account.heading': 'Your account',
  'account.currentPassword': 'Current password',
  'account.newPassword': 'New password',
  'account.newPasswordHelp': 'Leave this empty to keep your password and only replace your recovery phrase.',
  'account.submit': 'Continue',
  'account.signOutWarning': 'Finishing signs you out on every device, including this one.',
  'account.language': 'Interface language',
  'account.languageSaved': 'Language saved.',
  'account.languageFailed': 'Your language choice could not be saved. Showing your last saved language.',

  'settings.heading': 'Settings',
  'settings.allowedHeading': 'Allowed email addresses',
  'settings.allowedBody': 'One address per line. At most {max} addresses, including your own.',
  'settings.allowedLabel': 'Allowed addresses',
  'settings.ownerLocked': 'Your own address, {email}, must stay on the list.',
  'settings.removalWarning':
    'Removing an address immediately ends that person’s access on every device and cancels any unused invitation. Their account still takes up a seat until you deactivate it.',
  'settings.allowedSave': 'Save the list',
  'settings.allowedSaved': 'Allowed addresses saved.',
  'settings.allowedConflict':
    'The list changed somewhere else. Your text is kept below; compare it with the current list before saving again.',
  'settings.duplicate': 'This address appears more than once: {email}',
  'settings.invalidEntry': 'This does not look like an email address: {entry}',
  'settings.tooMany': 'That is {count} addresses. The limit is {max}, including your own.',
  'settings.yourText': 'Your text (not saved)',
  'settings.currentList': 'Current list · revision {n}',

  'invitations.heading': 'Invitations',
  'invitations.body': 'Invite an address that is already on the allowed list. Share the code yourself; nothing is emailed.',
  'invitations.email': 'Address to invite',
  'invitations.create': 'Create invitation',
  'invitations.codeHeading': 'Invitation code for {email}',
  'invitations.codeOnce': 'Copy it now. It is shown only once.',
  'invitations.expires': 'Expires {date}',
  'invitations.expired': 'Expired on {date}',
  'invitations.none': 'No invitations yet.',
  'invitations.revoke': 'Revoke',
  /* Accessible names start with the visible label so the two never disagree. */
  'invitations.revokeFor': 'Revoke the invitation for {email}',
  'invitations.revoked': 'Invitation revoked.',
  'invitations.status.pending': 'Waiting',
  'invitations.status.consumed': 'Used',
  'invitations.status.revoked': 'Revoked',
  'invitations.status.expired': 'Expired',

  'members.heading': 'People',
  'members.seats': '{active} of {max} seats in use',
  'members.role.owner': 'Owner',
  'members.role.member': 'Member',
  'members.status.active': 'Active',
  'members.status.inactive': 'Deactivated',
  'members.notAllowed': 'Removed from the allowed list but still using a seat',
  'members.deactivate': 'Deactivate',
  'members.deactivateFor': 'Deactivate {email}',
  'members.deactivateConfirm':
    'Deactivate {email}? This frees their seat, signs them out everywhere, and unassigns them from their cards. It cannot be undone.',
  'members.deactivated': '{email} was deactivated.',

  'board.heading': 'Board',
  'board.empty': 'No cards yet. Add the first one.',
  'board.columnEmpty': 'Nothing here yet.',
  'board.addCard': 'Add a card',
  'board.addColumn': 'Add a column',
  'board.columnName': 'Column name',
  'board.renameColumn': 'Rename {name}',
  /* The rename dialog's own title. It used to reuse `board.renameColumn` with an empty name,
     which left a dangling preposition in Hebrew. */
  'board.renameColumnHeading': 'Rename column',
  'board.deleteColumn': 'Delete {name}',
  'board.deleteColumnConfirm': 'Delete the column {name}? It must be empty first.',
  'board.moveColumnStart': 'Move {name} towards the start',
  'board.moveColumnEnd': 'Move {name} towards the end',
  'board.column.todo': 'To do',
  'board.column.in_progress': 'In progress',
  'board.column.done': 'Done',
  'board.cardCount.one': '{count} card',
  'board.cardCount.other': '{count} cards',
  'board.reload': 'Reload the board',
  'board.columnPosition': 'Column {n} of {total}',
  'board.addCardTo': 'Add a card to {column}',
  'board.scrollEnd': 'Scroll the board towards the end',

  'card.title': 'Title',
  'card.description': 'Description',
  'card.assignee': 'Assigned to',
  'card.unassigned': 'Nobody',
  'card.createHeading': 'New card',
  'card.editHeading': 'Edit card',
  'card.deleteConfirm': 'Delete the card {title}? This cannot be undone.',
  'card.actions': 'Actions for {title}',
  'card.dragHandle': 'Drag {title}',
  'card.moveUp': 'Move up',
  'card.moveDown': 'Move down',
  'card.moveToColumn': 'Move to column',
  'card.dragInstructions': 'Press Space or Enter to pick up a card, use the arrow keys to move it, and press Space or Enter again to drop it.',
  'card.dragPickedUp': 'Picked up {title}. Position {position} in {column}. Use the arrow keys to move it.',
  'card.dragOver': '{title} over {column}, position {position}.',
  'card.dragCanceled': 'Move canceled. {title} stayed in {column}.',
  'card.movedTo': '{title} moved to {column}, position {position}.',
  'card.moveRejected': '{title} was not moved. The board changed and has been reloaded.',
  'card.saved': '{title} saved.',
  'card.deleted': '{title} deleted.',
  'card.draftKept': 'Your unsaved text is still here. Review it and save again.',
  'card.changedElsewhere': 'Someone else changed this card while you were editing.',
  'card.descriptionCount': '{count} / {max}',
  'card.discardDraft': 'Discard changes',

  /* A due date is a calendar day. Which of these three a card shows is decided here, in the
     browser, against the viewer's own local date — never by the server in UTC. */
  'card.dueDate': 'Due date',
  'card.dueDateHelp': 'A date without a time. Leave it empty if there is no due date.',
  'card.due': 'Due {date}',
  'card.dueSoon': 'Due {date}',
  'card.overdue': 'Overdue {date}',
  'card.partOf': 'Part of',
  'card.partOfNone': 'Nothing',
  'card.partOfBadge': 'Part of {milestone}',
  /* Shown when the goals index could not be fetched: the card is linked to something, and this
     says so rather than implying it is linked to nothing. */
  'card.partOfUnknown': 'Part of a goal',

  'goals.heading': 'Goals',
  'goals.reload': 'Reload the goals',
  'goals.empty': 'No goals yet. Add the first one.',
  'goals.emptyYear': 'No goals for this year yet.',
  'goals.yearStrip': 'Year',
  'goals.year': 'Year',
  'goals.addGoal': 'Add a goal',
  'goals.createHeading': 'New goal',
  'goals.editHeading': 'Edit goal',
  'goals.title': 'Title',
  'goals.notes': 'Notes',
  'goals.actions': 'Actions for {title}',
  'goals.moveUp': 'Move up',
  'goals.moveDown': 'Move down',
  'goals.deleteConfirm':
    'Delete the goal {title}? Its milestones will be deleted with it, and any linked cards and images will be unlinked. This cannot be undone.',
  'goals.saved': '{title} saved.',
  'goals.deleted': '{title} deleted.',
  'goals.moved': '{title} moved to position {position}.',
  /* Both placeholders live in the English form of every category, because `plural()` passes the
     total as `count` and `{ done }` as an extra parameter. */
  'goals.progress.one': '{done} of {count} milestone done',
  'goals.progress.other': '{done} of {count} milestones done',
  'goals.milestoneCount.one': '{count} milestone',
  'goals.milestoneCount.other': '{count} milestones',
  'goals.noMilestones': 'No milestones yet.',
  /* An `<optgroup label>` is plain text, so the isolates are part of the template rather than
     elements around the parts. U+2068 opens, U+2069 closes. */
  'goals.optgroupLabel': '⁨{title}⁩ · ⁨{year}⁩',

  'milestone.add': 'Add a milestone',
  'milestone.addTo': 'Add a milestone to {title}',
  'milestone.createHeading': 'New milestone',
  'milestone.editHeading': 'Edit milestone',
  'milestone.title': 'Title',
  'milestone.notes': 'Notes',
  'milestone.month': 'Month',
  /* The visible text and the accessible name both name the action and never change with the
     state; `aria-pressed` is what carries the state, so it is announced exactly once. */
  'milestone.done': 'Done',
  'milestone.toggle': 'Done: {title}',
  'milestone.markedDone': '{title} marked done.',
  'milestone.markedOpen': '{title} marked not done.',
  'milestone.actions': 'Actions for {title}',
  'milestone.deleteConfirm': 'Delete the milestone {title}? Any cards linked to it will be unlinked. This cannot be undone.',
  'milestone.saved': '{title} saved.',
  'milestone.deleted': '{title} deleted.',
  'milestone.moved': '{title} moved to position {position}.',
  'milestone.noCards': 'No cards linked yet.',
  'milestone.cardChip': 'Card · {title}',
  'milestone.optionLabel': '⁨{month}⁩ · ⁨{title}⁩',

  'vision.heading': 'Vision board',
  'vision.reload': 'Reload the vision board',
  'vision.empty': 'No images yet. Add the first one.',
  'vision.imageCount.one': '{count} image',
  'vision.imageCount.other': '{count} images',
  'vision.addImages': 'Add images',
  'vision.addHelp':
    'JPEG, PNG or WebP. Each image is resized in your browser before it is uploaded, which also removes any location data a phone photo carries. HEIC photos from Apple devices cannot be read here — export them as JPEG first.',
  'vision.tile': 'Open {caption}',
  'vision.tileAt': 'Open image {n}',
  /* The visible label under a tile with no caption. A noun, because it sits where a caption
     would: `vision.tileAt` names the *action* and belongs to the button, not to the page. */
  'vision.untitled': 'Image {n}',
  'vision.caption': 'Caption',
  'vision.goalLink': 'Part of',
  'vision.goalNone': 'Nothing',
  'vision.editHeading': 'Edit image',
  'vision.actions': 'Actions for image {n}',
  'vision.moveEarlier': 'Move earlier',
  'vision.moveLater': 'Move later',
  'vision.deleteConfirm': 'Delete this image? This cannot be undone.',
  'vision.added': 'Image added.',
  'vision.saved': 'Image saved.',
  'vision.deleted': 'Image deleted.',
  'vision.moved': 'Image moved to position {position}.',
  'vision.carousel': 'Images',
  'vision.previous': 'Previous image',
  'vision.next': 'Next image',
  /* Also the static marker under `prefers-reduced-motion`, where the transition is removed. */
  'vision.position': 'Image {n} of {total}',
  'vision.uploadHeading': 'Adding images',
  'vision.fileQueued': 'Waiting',
  'vision.filePreparing': 'Preparing',
  'vision.fileUploading': 'Uploading',
  'vision.fileDone': 'Added',
  'vision.fileFailed': 'Could not be added',
  'vision.fileUnreadable': 'This file could not be read as an image. If it is an Apple HEIC photo, export it as JPEG first.',

  'error.generic': 'Something went wrong. Try again.',
  /* Reworded for Stage 8: this sentence is now reachable from the goals and vision screens too,
     so it can no longer name the board. */
  'error.network': 'The app could not be reached. Check your connection.',
  'error.invalid_request': 'Check the highlighted fields and try again.',
  'error.unauthenticated': 'Your session ended. Sign in again.',
  'error.invalid_credentials': 'The email address or password is incorrect.',
  'error.forbidden': 'You do not have access to that.',
  'error.already_authenticated': 'You are already signed in.',
  'error.not_found': 'That is no longer available.',
  'error.rate_limited': 'Too many attempts. Wait a few minutes and try again.',
  'error.unavailable': 'The app is temporarily unavailable. Try again shortly.',
  'error.bootstrap_consumed': 'The owner account already exists.',
  'error.email_taken': 'That address already has an account.',
  'error.email_not_allowed': 'Add that address to the allowed list first.',
  'error.seats_full': 'Every seat is in use. Deactivate someone first.',
  'error.invalid_invitation': 'That invitation cannot be used.',
  'error.invalid_pending_token': 'That sign-up has expired. Start again.',
  'error.invalid_phrase': 'That recovery phrase does not match.',
  'error.invalid_challenge': 'That recovery request has expired. Start again.',
  'error.recovery_failed': 'That request could not be completed.',
  'error.rotation_conflict': 'Your credentials changed elsewhere. Start again.',
  'error.too_many_rotations': 'Finish or wait out the pending recovery request first.',
  'error.allowlist_conflict': 'The allowed list changed somewhere else.',
  'error.invitation_consumed': 'That invitation was already used.',
  'error.cannot_deactivate_owner': 'The owner account cannot be deactivated.',
  /* One code serves all three domains, because `errorText` looks up `error.${code}` with no
     domain context. That only holds while the sentence does not name the board. */
  'error.revision_conflict': 'This changed somewhere else and has been reloaded.',
  'error.column_not_empty': 'Move or delete the cards in that column first.',
  'error.last_column': 'A board must keep at least one column.',
  'error.board_full': 'This board is full. Delete a card to add another.',
  'error.column_limit': 'This board already has the maximum number of columns.',
  /* Has to cover an over-long description and an over-large image alike. */
  'error.payload_too_large': 'That is too large to save. Try shorter text, or a smaller image.',
  'error.unsupported_media_type': 'That request could not be sent.',
  'error.goal_limit': 'There is no room for another goal. Delete one first.',
  'error.milestone_limit': 'There is no room for another milestone. Delete one first.',
  'error.image_limit': 'The vision board is full. Delete an image to add another.',
  /* One code for both the image budget and the database backstop; the sentence names neither. */
  'error.storage_full': 'The vision board has no room left. Delete an image first.',
  'error.image_too_large': 'That image is too large.',
  'error.unsupported_image_type': 'That image type is not supported. Use JPEG, PNG or WebP.',
  'error.image_rejected': 'That image could not be read.',

  'field.email.invalid_email': 'Enter a valid email address.',
  'field.password.too_short': 'Use at least 12 characters.',
  'field.password.too_long': 'Use at most 128 characters.',
  'field.password.too_common': 'That password appears in lists of known passwords. Choose another.',
  'field.password.invalid_characters': 'That password contains characters that cannot be used.',
  'field.password.reused': 'Choose a password you have not used here before.',
  'field.emails.invalid_emails': 'One of these lines is not a valid address, or an address is repeated.',
  'field.emails.invalid_count': 'Keep between 1 and {max} addresses, including your own.',
  'field.emails.owner_required': 'Your own address must stay on the list.',
  'field.title.required': 'Enter a title.',
  'field.title.too_long': 'That title is too long.',
  'field.title.invalid': 'That title contains characters that cannot be saved.',
  'field.description.too_long': 'That description is too long.',
  'field.description.invalid': 'That description contains characters that cannot be saved.',
  'field.name.required': 'Enter a column name.',
  'field.name.too_long': 'That column name is too long.',
  'field.name.invalid': 'That column name contains characters that cannot be saved.',
  'field.assigneeUserId.ineligible': 'That person can no longer be assigned cards.',
  'field.assigneeUserId.invalid': 'That assignee is not valid.',
  'field.targetIndex.out_of_range': 'That position is no longer available.',
  'field.targetIndex.invalid': 'That position is not valid.',
  /* Reworded with its two Stage 8 siblings: all three name a field the member cannot see, so
     the sentence has to be an instruction rather than a description. */
  'field.boardRevision.invalid': 'Reload and try again.',
  'field.goalsRevision.invalid': 'Reload and try again.',
  'field.visionRevision.invalid': 'Reload and try again.',
  'field.year.invalid': 'Enter a year as four digits.',
  'field.year.out_of_range': 'Choose a year between 2000 and 2999.',
  'field.month.invalid': 'Choose a month.',
  'field.dueDate.invalid': 'Enter a valid date with a day, month and year.',
  'field.dueDate.out_of_range': 'Choose a date between the years 2000 and 2999.',
  'field.notes.too_long': 'Those notes are too long.',
  'field.notes.invalid': 'Those notes contain characters that cannot be saved.',
  'field.caption.too_long': 'That caption is too long.',
  'field.caption.invalid': 'A caption is one line, without characters that cannot be saved.',
  'field.status.invalid': 'That is not a valid milestone status.',
  'field.goalId.invalid': 'That goal is no longer available.',
  'field.milestoneId.invalid': 'That milestone is no longer available.',
  /* A thumbnail fault is reported under `data` and `mediaType`, and any dimension fault under
     `width`, rather than inventing three more families that would say the same sentence. */
  'field.data.invalid': 'That image could not be read.',
  'field.mediaType.invalid': 'That image type cannot be used here.',
  'field.width.invalid': 'Those image dimensions are not valid.',
  'field.fallback': 'Check this field and try again.'
} as const;

export type TranslationKey = keyof typeof en;

/** Every dictionary must supply all of these, whatever its plural rules are. */
export type Dictionary = Readonly<Record<TranslationKey, string>>;

export type PluralCategory = 'zero' | 'one' | 'two' | 'few' | 'many' | 'other';

/** Key families that take a plural form, derived from the English key set. */
export type PluralBase = TranslationKey extends infer Key
  ? Key extends `${infer Base}.${PluralCategory}`
    ? Base
    : never
  : never;

export type NonPluralKey = TranslationKey extends infer Key
  ? Key extends `${PluralBase}.${PluralCategory}`
    ? never
    : Key
  : never;

/**
 * A translated dictionary.
 *
 * Plural categories differ by language — English needs two forms, Hebrew four, Russian four —
 * so plural keys are optional here and the `check:i18n` script is what verifies each locale
 * supplies exactly the categories its own rules require.
 */
export type LocaleDictionary = Readonly<Record<NonPluralKey, string>> &
  Readonly<Partial<Record<`${PluralBase}.${PluralCategory}`, string>>>;
