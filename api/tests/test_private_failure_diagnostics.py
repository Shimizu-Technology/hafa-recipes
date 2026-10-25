"""Private request failures remain useful without retaining private content."""

import asyncio
import threading
from types import SimpleNamespace
from uuid import UUID

import httpx
import pytest
from fastapi import APIRouter, FastAPI, HTTPException
from starlette.responses import JSONResponse, StreamingResponse

from app.domains.baby.security import BabyRoute
from app.domains.workouts import privacy
from app.domains.workouts.security import WorkoutsImportRoute, WorkoutsRoute
from app.request_context import RequestContextMiddleware


@pytest.mark.parametrize('product,route_class', [('baby', BabyRoute), ('workouts', WorkoutsRoute)])
@pytest.mark.parametrize('failure,status,code', [
    ('typed', 503, 'provider_unavailable'), ('private', 409, 'unknown'),
    ('validation', 422, 'validation_error'), ('unexpected', 500, 'unexpected_error'),
    ('response', 401, 'http_error'), ('response', 403, 'http_error'),
    ('response', 404, 'http_error'), ('response', 413, 'http_error'),
    ('response', 429, 'http_error'), ('early', 429, 'http_error'), ('success', 200, None),
])
async def test_private_route_failure_is_content_free_and_preserves_response(
    monkeypatch, caplog, product, route_class, failure, status, code,
):
    from app.domains.baby import security as baby_security
    from app.domains.workouts import security as workouts_security

    settings = SimpleNamespace(baby_api_enabled=True, workouts_api_enabled=True,
                               app_release_id='synthetic-release')
    for module in (privacy, baby_security, workouts_security):
        monkeypatch.setattr(module, 'get_settings', lambda: settings)
    events = []
    monkeypatch.setattr(privacy.sentry_sdk, 'capture_event', events.append)
    app = FastAPI()
    app.add_middleware(RequestContextMiddleware)
    if failure == 'early':
        class EarlyFailureRoute(route_class):
            async def handle(self, scope, receive, send):
                await JSONResponse({'body': 'PRIVATE'}, status_code=429)(scope, receive, send)
        route_class = EarlyFailureRoute
    router = APIRouter(prefix=f'/api/v1/{product}', route_class=route_class)

    @router.post('/records/{record_id}')
    async def endpoint(record_id: str, count: int):
        if failure == 'typed':
            raise HTTPException(503, {'code': 'provider_unavailable', 'body': 'PRIVATE'})
        if failure == 'private':
            raise HTTPException(409, 'PRIVATE exception URL user-id')
        if failure == 'unexpected':
            raise RuntimeError('PRIVATE provider exception text')
        return JSONResponse({'body': 'PRIVATE'}, status_code=status)

    app.include_router(router)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app, raise_app_exceptions=False),
                                 base_url='https://api.invalid') as client:
        response = await client.post(f'/api/v1/{product}/records/PRIVATE?count=' +
                                     ('PRIVATE' if failure == 'validation' else '1'),
                                     content='{"source":"PRIVATE"}',
                                     headers={'X-Request-ID': 'PRIVATE', 'X-Hafa-Account-ID': 'PRIVATE'})
    assert response.status_code == status
    if failure == 'typed':
        assert response.json() == {'detail': {'code': 'provider_unavailable', 'body': 'PRIVATE'}}
    elif failure == 'private':
        assert response.json() == {'detail': 'PRIVATE exception URL user-id'}
    if code is None:
        assert events == []
        assert not [record for record in caplog.records if record.name == privacy.__name__]
        return
    diagnostic = [record.getMessage() for record in caplog.records if record.name == privacy.__name__]
    assert len(diagnostic) == 1 and 'PRIVATE' not in diagnostic[0]
    for field in (f'product={product}', f'route=/api/v1/{product}/records/{{record_id}}',
                  f'http_status={status}', f'error_code={code}'):
        assert field in diagnostic[0]
    if status < 500:
        assert events == []
        return
    assert len(events) == 1
    clean = privacy.redact_workouts_event(events[0])
    tags = clean['tags']
    assert tags == {'product': product, 'route': f'/api/v1/{product}/records/{{record_id}}',
                    'http_status': str(status), 'error_code': code, 'stage': 'request',
                    'correlation_id': tags['correlation_id']}
    assert UUID(tags['correlation_id']).version == 4
    assert clean['release'] == 'synthetic-release'
    assert 'PRIVATE' not in repr(clean)
    diagnostic = [record.getMessage() for record in caplog.records if record.name == privacy.__name__]
    assert len(diagnostic) == 1 and 'PRIVATE' not in diagnostic[0]
    assert 'request' not in clean and 'exception' not in clean


@pytest.mark.parametrize('busy,status,code', [
    (True, 429, 'workouts_import_busy'), (False, 408, 'workouts_import_timeout'),
])
async def test_real_import_route_early_failures_keep_fixed_private_diagnostics(
    monkeypatch, caplog, busy, status, code,
):
    from app.domains.workouts import security

    settings = SimpleNamespace(workouts_api_enabled=True, app_release_id='synthetic-release')
    for module in (privacy, security):
        monkeypatch.setattr(module, 'get_settings', lambda: settings)
    gate = threading.Lock()
    if busy:
        gate.acquire()
    monkeypatch.setattr(security, '_import_ingress', gate)
    monkeypatch.setattr(security, 'IMPORT_INGRESS_SECONDS', 0.03)
    events = []
    monkeypatch.setattr(privacy.sentry_sdk, 'capture_event', events.append)
    app = FastAPI()
    app.add_middleware(RequestContextMiddleware)
    router = APIRouter(prefix='/api/v1/workouts', route_class=WorkoutsImportRoute)

    @router.post('/imports/{record_id}')
    async def endpoint(record_id: str, payload: dict):
        pytest.fail('Early import rejection must precede the endpoint')

    app.include_router(router)

    async def body():
        assert not busy, 'Busy ingress must not consume the body'
        yield b'{"source":"PRIVATE"'
        await asyncio.Event().wait()

    try:
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app),
                                     base_url='https://api.invalid') as client:
            response = await client.post('/api/v1/workouts/imports/PRIVATE?secret=PRIVATE',
                                         content=body(), headers={'X-Request-ID': 'PRIVATE',
                                                                 'X-Hafa-Account-ID': 'PRIVATE'})
        assert response.status_code == status
        assert response.json() == {'detail': code}
        assert response.headers['Retry-After'] == '2'
        assert response.headers['Cache-Control'] == 'no-store'
        assert gate.locked() == busy
        assert events == []
        diagnostic = [record.getMessage() for record in caplog.records if record.name == privacy.__name__]
        assert len(diagnostic) == 1 and f'error_code={code}' in diagnostic[0]
        assert f'http_status={status}' in diagnostic[0]
        assert 'route=/api/v1/workouts/imports/{record_id}' in diagnostic[0]
        assert UUID(diagnostic[0].split('correlation_id=')[1]).version == 4
        assert 'PRIVATE' not in diagnostic[0]
    finally:
        if gate.locked():
            gate.release()


def test_coach_compatibility_keeps_only_allowlisted_tags():
    event = {'request': {'url': '/api/v1/workouts/coach/messages'},
             'release': 'synthetic-release', 'exception': {'value': 'PRIVATE'},
             'tags': {'error_code': 'provider_unavailable', 'http_status': 503,
                      'exception_class': 'CoachFailure', 'request_id': 'PRIVATE',
                      'route': '/api/v1/workouts/records/PRIVATE?secret=PRIVATE',
                      'stage': 'PRIVATE', 'correlation_id': 'PRIVATE', 'user_id': 'PRIVATE'}}
    assert privacy.redact_workouts_event(event)['tags'] == {
        'product': 'workouts', 'error_code': 'provider_unavailable',
        'http_status': '503', 'exception_class': 'CoachFailure',
    }
    assert 'fingerprint' not in privacy.redact_workouts_event(event)
    event['tags'].update(error_code='PRIVATE', exception_class='PRIVATE', http_status='503 PRIVATE')
    assert privacy.redact_workouts_event(event)['tags'] == {'product': 'workouts'}


@pytest.mark.parametrize('product', ['baby', 'workouts'])
def test_private_failure_grouping_uses_only_stable_sanitized_tags(product):
    route = f'/api/v1/{product}/grouping/{{record_id}}'
    other_route = f'/api/v1/{product}/other-grouping/{{record_id}}'
    privacy.PrivateFailureRoute(route, endpoint=lambda: None)
    privacy.PrivateFailureRoute(other_route, endpoint=lambda: None)
    event = {'request': {'url': route}, 'exception': {'value': 'PRIVATE'},
             'fingerprint': ['PRIVATE'],
             'tags': {'route': route, 'http_status': 503, 'error_code': 'provider_unavailable',
                      'correlation_id': '00000000000040008000000000000000', 'user_id': 'PRIVATE'}}
    clean = privacy.redact_workouts_event(event)
    assert clean['fingerprint'] == [product, route, '503', 'provider_unavailable']
    event['tags']['correlation_id'] = '11111111111141119111111111111111'
    assert privacy.redact_workouts_event(event)['fingerprint'] == clean['fingerprint']
    for key, value in [('route', other_route), ('http_status', 500), ('error_code', 'timeout')]:
        changed = event | {'tags': event['tags'] | {key: value}}
        assert privacy.redact_workouts_event(changed)['fingerprint'] != clean['fingerprint']
    event['tags'].update(http_status='PRIVATE', error_code='PRIVATE', response_status='200 PRIVATE')
    sanitized = privacy.redact_workouts_event(event)
    assert sanitized['fingerprint'] == [product, route, 'unknown', 'unknown']
    assert 'response_status' not in sanitized['tags']
    assert 'PRIVATE' not in repr(sanitized)
    event['tags']['route'] = f'/api/v1/{product}/grouping/PRIVATE?secret=PRIVATE'
    assert 'fingerprint' not in privacy.redact_workouts_event(event)


@pytest.mark.parametrize('product', ['baby', 'workouts'])
@pytest.mark.parametrize('failure', ['generator', 'send', 'success'])
@pytest.mark.parametrize('status', [200, 206])
async def test_started_private_stream_keeps_server_failure_and_client_status_separate(
    monkeypatch, caplog, product, failure, status,
):
    monkeypatch.setattr(privacy, 'get_settings', lambda: SimpleNamespace(app_release_id='synthetic-release'))
    events = []
    monkeypatch.setattr(privacy.sentry_sdk, 'capture_event', events.append)

    async def content():
        yield b'PRIVATE chunk'
        if failure == 'generator':
            raise RuntimeError('PRIVATE source exception')

    async def endpoint():
        return StreamingResponse(content(), status_code=status)

    app = FastAPI()
    app.add_middleware(RequestContextMiddleware)
    router = APIRouter(route_class=privacy.PrivateFailureRoute)
    path = f'/api/v1/{product}/stream/{{record_id}}'
    router.add_api_route(path, endpoint)
    app.include_router(router)
    scope = {'type': 'http', 'asgi': {'spec_version': '2.4'}, 'method': 'GET',
             'path': f'/api/v1/{product}/stream/PRIVATE', 'query_string': b'secret=PRIVATE',
             'scheme': 'https', 'http_version': '1.1',
             'headers': [(b'x-request-id', b'PRIVATE')]}
    messages = []

    async def send(message):
        messages.append(message)
        if failure == 'send' and message['type'] == 'http.response.body':
            raise RuntimeError('PRIVATE transport exception')

    if failure == 'success':
        await app(scope, None, send)
        assert events == []
        assert not [record for record in caplog.records if record.name == privacy.__name__]
    else:
        with pytest.raises(RuntimeError, match='PRIVATE'):
            await app(scope, None, send)
        assert len(events) == 1
        clean = privacy.redact_workouts_event(events[0])
        assert clean['tags']['http_status'] == '500'
        assert clean['tags']['response_status'] == str(status)
        assert clean['tags']['error_code'] == 'unexpected_error'
        assert clean['fingerprint'] == [product, path, '500', 'unexpected_error']
        diagnostic = [record.getMessage() for record in caplog.records if record.name == privacy.__name__]
        assert len(diagnostic) == 1 and f'http_status=500 response_status={status}' in diagnostic[0]
        assert 'PRIVATE' not in repr(events) + repr(clean) + repr(diagnostic)
    assert messages[0]['status'] == status
    assert messages[1]['body'] == b'PRIVATE chunk'


async def test_diagnostic_sink_failure_cannot_replace_the_original_response(monkeypatch):
    from app import request_context

    def unavailable(*args, **kwargs):
        raise RuntimeError('PRIVATE sink error')

    monkeypatch.setattr(request_context, 'report_private_failure', unavailable)
    app = FastAPI()
    app.add_middleware(RequestContextMiddleware)

    @app.get('/api/v1/workouts/diagnostic')
    async def endpoint():
        raise HTTPException(409, 'original response')

    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='https://api.invalid') as client:
        response = await client.get('/api/v1/workouts/diagnostic')
    assert response.status_code == 409 and response.json() == {'detail': 'original response'}
