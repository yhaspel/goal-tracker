#!/usr/bin/env python3
"""Run Stage 1 checks against the deployed test Worker without printing secrets."""

import argparse
import concurrent.futures
import json
import re
import secrets
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SECRET_FILE = ROOT / '.secrets.test'
NONCE_FILE = ROOT / '.probe-nonce.test'
COLD_FILE = ROOT / '.cold-samples.test.jsonl'


def request(base, path, *, method='GET', body=None, secret=None, navigate=False):
    headers = {'User-Agent': 'curl/8.7.1'}
    if secret:
        headers['X-Diagnostic-Secret'] = secret
    if navigate:
        headers['Sec-Fetch-Mode'] = 'navigate'
    payload = None if body is None else json.dumps(body).encode()
    if payload is not None:
        headers['Content-Type'] = 'application/json'
    req = urllib.request.Request(base + path, data=payload, headers=headers, method=method)
    start = time.perf_counter()
    try:
        response = urllib.request.urlopen(req, timeout=30)
    except urllib.error.HTTPError as error:
        response = error
    with response:
        content = response.read()
        return {
            'status': response.status,
            'content_type': response.headers.get('Content-Type', ''),
            'headers': dict(response.headers),
            'body': content,
            'elapsed_ms': (time.perf_counter() - start) * 1000,
        }


def data(response, status=200):
    if response['status'] != status:
        raise RuntimeError(f"Unexpected HTTP {response['status']}: {response['body'][:120]!r}")
    return json.loads(response['body'])['data']


def expected_schema_version():
    """The schema version this checkout would apply, read from the migration module."""
    source = (ROOT / 'worker' / 'src' / 'db' / 'migrations.ts').read_text()
    match = re.search(r'export const SCHEMA_VERSION\s*=\s*(\d+)', source)
    assert match, 'SCHEMA_VERSION not found in worker/src/db/migrations.ts'
    return int(match.group(1))


def await_schema_version(base, expected, timeout_s=300, interval_s=20):
    """Wait for the deployed Worker to report this checkout's schema version.

    A fresh `wrangler deploy` needs time to propagate, and the schema version comes from the
    Durable Object, which keeps running the previous code until it is evicted. Eviction needs
    the object to be idle, so this polls slowly on purpose: a tight loop keeps the object warm
    and prevents the very restart it is waiting for.
    """
    deadline = time.monotonic() + timeout_s
    seen = None
    while True:
        health = request(base, '/api/v1/health')
        seen = data(health)
        if seen.get('schemaVersion') == expected:
            return health
        if time.monotonic() >= deadline:
            raise RuntimeError(f'deployed schemaVersion {seen.get("schemaVersion")!r} never reached {expected}')
        time.sleep(interval_s)


def await_served_assets(base, timeout_s=300, interval_s=20):
    """Wait until the served index page and the assets it names come from the same version.

    Static Assets and the Worker script do not always reach an edge together. For a short
    window after a deploy the new index.html can be served while its hashed bundle is still
    missing, or the previous index.html can point at a bundle that has just been replaced.
    Either way the reference 404s, which is a propagation race rather than a broken build, so
    this retries the whole pair instead of asserting once.
    """
    deadline = time.monotonic() + timeout_s
    while True:
        index = request(base, '/')
        referenced = re.findall(r'(?:src|href)="(/assets/[^"]+\.(?:js|css))"', index['body'].decode())
        fetched = [(path, request(base, path)) for path in referenced]
        complete = bool(referenced) and all(
            response['status'] == 200 and ('javascript' in response['content_type'] or 'css' in response['content_type'])
            for _, response in fetched
        )
        if complete:
            return referenced
        if time.monotonic() >= deadline:
            detail = ', '.join(f'{path} -> {response["status"]}' for path, response in fetched) or 'none referenced'
            raise RuntimeError(f'index page and its assets never agreed: {detail}')
        time.sleep(interval_s)


def percentile(values, p):
    ordered = sorted(values)
    rank = (len(ordered) - 1) * p
    low = int(rank)
    high = min(low + 1, len(ordered) - 1)
    return round(ordered[low] + (ordered[high] - ordered[low]) * (rank - low), 2)


def routing(base):
    expected_version = expected_schema_version()
    health = await_schema_version(base, expected_version)
    for path in ['/', '/login', '/board']:
        for navigate in [False, True]:
            response = request(base, path, navigate=navigate)
            assert response['status'] == 200 and 'text/html' in response['content_type'], path
    referenced = await_served_assets(base)
    script = next(path for path in referenced if path.endswith('.js'))
    for path in ['/assets/not-found.js', '/assets/x/y.png', '/foo.png', '/arbitrary', '/api', '/api/unknown', '/api/v1/unknown']:
        for navigate in [False, True]:
            response = request(base, path, navigate=navigate)
            assert response['status'] == 404 and 'text/html' not in response['content_type'], path
            if path.startswith('/api'):
                assert json.loads(response['body']) == {'error': {'code': 'not_found', 'message': 'Not found'}}
    assert data(health) == {'status': 'ok', 'schemaVersion': expected_version}
    assert health['headers'].get('Cache-Control') == 'no-store'
    wrong = request(base, '/api/v1/health', method='POST')
    assert wrong['status'] == 405 and wrong['headers'].get('Allow') == 'GET'
    return {'passed': True, 'asset': script, 'schema_version': expected_version}


def probe_write(base, secret):
    nonce = secrets.token_hex(16)
    denied = request(base, '/api/v1/diagnostics/probe', method='POST', body={'nonce': nonce})
    assert denied['status'] == 404
    data(request(base, '/api/v1/diagnostics/probe', method='POST', body={'nonce': nonce}, secret=secret), 201)
    NONCE_FILE.write_text(nonce)
    NONCE_FILE.chmod(0o600)
    return {'written': True, 'nonce_file': str(NONCE_FILE)}


def probe_read_remove(base, secret):
    nonce = NONCE_FILE.read_text().strip()
    path = f'/api/v1/diagnostics/probe?nonce={nonce}'
    assert data(request(base, path, secret=secret)) == {'found': True}
    assert data(request(base, path, method='DELETE', secret=secret)) == {'removed': True}
    assert data(request(base, path, secret=secret)) == {'found': False}
    NONCE_FILE.unlink()
    return {'persisted_after_redeploy': True, 'removed': True}


def benchmark(base, secret):
    path = '/api/v1/diagnostics/scrypt'
    password = secrets.token_urlsafe(32)

    def hash_once():
        result = request(base, path, method='POST', body={'action': 'hash', 'password': password}, secret=secret)
        value = data(result)
        return {'total_ms': result['elapsed_ms'], 'operation_ms': value['operationMs'], 'wait_ms': value['waitMs'],
                'salt': value['salt'], 'hash': value['hash']}

    first = hash_once()
    warm = [hash_once() for _ in range(20)]
    assert first['salt'] != warm[0]['salt'] and first['hash'] != warm[0]['hash']
    verify = request(base, path, method='POST', body={'action': 'verify', 'password': password, 'salt': first['salt'], 'hash': first['hash']}, secret=secret)
    wrong = request(base, path, method='POST', body={'action': 'verify', 'password': password + 'x', 'salt': first['salt'], 'hash': first['hash']}, secret=secret)
    assert data(verify)['verified'] is True and data(wrong)['verified'] is False

    started = time.perf_counter()
    with concurrent.futures.ThreadPoolExecutor(max_workers=7) as executor:
        futures = [executor.submit(hash_once) for _ in range(7)]
        burst = [future.result(timeout=30) for future in futures]
    burst_ms = (time.perf_counter() - started) * 1000
    internal_clock_observable = any(sample['operation_ms'] > 0 for sample in warm)
    result = {
        'checked_at_utc': datetime.now(timezone.utc).isoformat(),
        'host': base,
        'parameters': {'N': 16384, 'r': 8, 'p': 5, 'salt_bytes': 16, 'key_bytes': 32},
        'cold_candidate_first_request_ms': round(first['total_ms'], 2),
        'warm_samples': len(warm),
        'warm_total_p50_ms': percentile([sample['total_ms'] for sample in warm], .5),
        'warm_total_p95_ms': percentile([sample['total_ms'] for sample in warm], .95),
        'warm_operation_p95_ms': percentile([sample['operation_ms'] for sample in warm], .95) if internal_clock_observable else None,
        'burst_requests': len(burst),
        'burst_total_ms': round(burst_ms, 2),
        'burst_peak_queue_wait_ms': round(max(sample['wait_ms'] for sample in burst), 2) if internal_clock_observable else None,
        'do_internal_timers_observable': internal_clock_observable,
        'burst_failures': 0,
        'hash_verify_correct': True,
        'hash_verify_wrong_rejected': True,
        'two_salts_differ': True,
        'passes_measured_thresholds': percentile([sample['total_ms'] for sample in warm], .95) < 5000 and burst_ms < 15000,
    }
    return result


def cold_sample(base, secret):
    password = secrets.token_urlsafe(32)
    response = request(base, '/api/v1/diagnostics/scrypt', method='POST',
                       body={'action': 'hash', 'password': password}, secret=secret)
    value = data(response)
    session = response['headers'].get('X-Diagnostic-Session')
    if not session:
        raise RuntimeError('No diagnostic session marker in response')
    previous = None
    if COLD_FILE.exists():
        lines = COLD_FILE.read_text().splitlines()
        if lines:
            previous = json.loads(lines[-1])['session']
    confirmed = previous is not None and previous != session
    record = {'session': session, 'confirmed_new_session': confirmed,
              'elapsed_ms': round(response['elapsed_ms'], 2),
              'operation_ms': round(value['operationMs'], 2)}
    with COLD_FILE.open('a') as file:
        file.write(json.dumps(record) + '\n')
    COLD_FILE.chmod(0o600)
    return {'confirmed_new_session': confirmed, 'elapsed_ms': record['elapsed_ms'],
            'total_samples': len(COLD_FILE.read_text().splitlines())}


def cold_summary():
    records = [json.loads(line) for line in COLD_FILE.read_text().splitlines()]
    confirmed = [record['elapsed_ms'] for record in records if record['confirmed_new_session']]
    return {'confirmed_cold_samples': len(confirmed),
            'p50_ms': percentile(confirmed, .5) if confirmed else None,
            'p95_ms': percentile(confirmed, .95) if confirmed else None,
            'passes_cold_threshold': len(confirmed) >= 20 and percentile(confirmed, .95) < 5000}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('base_url', help='https://<test-worker>.<subdomain>.workers.dev')
    parser.add_argument('mode', choices=['routing', 'probe-write', 'probe-read-remove', 'benchmark', 'cold-sample', 'cold-summary'])
    args = parser.parse_args()
    base = args.base_url.rstrip('/')
    secret = SECRET_FILE.read_text().strip() if args.mode not in ('routing', 'cold-summary') else None
    if args.mode == 'routing': result = routing(base)
    elif args.mode == 'probe-write': result = probe_write(base, secret)
    elif args.mode == 'probe-read-remove': result = probe_read_remove(base, secret)
    elif args.mode == 'cold-sample': result = cold_sample(base, secret)
    elif args.mode == 'cold-summary': result = cold_summary()
    else: result = benchmark(base, secret)
    print(json.dumps(result, indent=2, sort_keys=True))


if __name__ == '__main__':
    main()
