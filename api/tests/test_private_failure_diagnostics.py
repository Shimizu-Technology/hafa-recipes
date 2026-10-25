"""Private request failures remain useful without retaining private content."""

from types import SimpleNamespace
from uuid import UUID

import httpx
import pytest
from fastapi import APIRouter, FastAPI, HTTPException
from starlette.responses import JSONResponse

from app.domains.baby.security import BabyRoute
from app.domains.workouts import privacy
from app.domains.workouts.security import WorkoutsRoute
from app.request_context import RequestContextMiddleware


@pytest.mark.parametrize('product,route_class', [('baby', BabyRoute), ('workouts', WorkoutsRoute)])
@pytest.mark.parametrize('failure,status,code', [
    ('typed', 503, 'provider_unavailable'), ('private', 409, 'unknown'),
    ('validation', 422, 'validation_error'), ('unexpected', 500, 'unexpected_error'),
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
    event['tags'].update(error_code='PRIVATE', exception_class='PRIVATE', http_status='503 PRIVATE')
    assert privacy.redact_workouts_event(event)['tags'] == {'product': 'workouts'}


async def test_diagnostic_sink_failure_cannot_replace_the_original_response(monkeypatch):
    from app import request_context

    def unavailable(*args):
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
