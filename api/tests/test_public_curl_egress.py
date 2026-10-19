"""Native libcurl wire tests; all listeners are local, ephemeral and joined.

Only the public resolver seam is replaced for .test fixture hostnames. Native
libcurl, TLS verification, CONNECT negotiation and HTTP requests remain real.
The test certificate deliberately excludes IP SANs: losing original TLS identity
therefore fails verification, rather than passing through a permissive TLS mock.
"""

import socket
import ssl
import threading
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from urllib.parse import urlsplit

import httpx
import pytest
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.x509.oid import NameOID
from curl_cffi import CurlOpt
from curl_cffi.requests.exceptions import RequestException as CurlRequestError
from yt_dlp.networking.common import Request
from yt_dlp.networking.exceptions import RequestError, TransportError

from app import security
from app.services import public_ytdlp as public


class _NestedTLS:
    """Server TLS over an existing TLS proxy stream, using standard SSL BIOs."""

    def __init__(self, stream, context):
        self.stream = stream
        self.incoming, self.outgoing = ssl.MemoryBIO(), ssl.MemoryBIO()
        self.tls = context.wrap_bio(self.incoming, self.outgoing, server_side=True)
        self._perform(self.tls.do_handshake)

    def _flush(self):
        while payload := self.outgoing.read():
            self.stream.sendall(payload)

    def _perform(self, action):
        while True:
            try:
                result = action()
                self._flush()
                return result
            except ssl.SSLWantReadError:
                self._flush()
                payload = self.stream.recv(65536)
                if not payload:
                    raise EOFError("TLS fixture peer closed")
                self.incoming.write(payload)

    def recv(self, count):
        return self._perform(lambda: self.tls.read(count))

    def sendall(self, data):
        self._perform(lambda: self.tls.write(data))


def _headers(stream):
    payload = b""
    while b"\r\n\r\n" not in payload:
        chunk = stream.recv(1)
        if not chunk:
            raise EOFError("HTTP fixture peer closed")
        payload += chunk
        if len(payload) > 32768:
            raise ValueError("Oversized fixture headers")
    return payload


class WireServer:
    def __init__(self, context, *, proxy_scheme=None, target_scheme="https", reply=None):
        self.context, self.proxy_scheme, self.target_scheme = context, proxy_scheme, target_scheme
        self.reply = reply or (lambda path: (200, {}, b"caption"))
        self.requests, self.connects, self.errors, self.clients = [], [], [], []
        self.listener = socket.socket()
        self.listener.bind(("127.0.0.1", 0))
        self.listener.listen()
        self.listener.settimeout(0.1)
        self.port = self.listener.getsockname()[1]
        self.stopped = threading.Event()
        self.thread = threading.Thread(target=self._accept)
        self.thread.start()

    def _accept(self):
        while not self.stopped.is_set():
            try:
                connection, _ = self.listener.accept()
            except socket.timeout:
                continue
            except OSError:
                break
            thread = threading.Thread(target=self._serve, args=(connection,))
            self.clients.append(thread)
            thread.start()

    def _serve(self, connection):
        connection.settimeout(5)
        try:
            stream = connection
            if self.proxy_scheme == "https":
                stream = self.context.wrap_socket(stream, server_side=True)
            if self.proxy_scheme:
                self.connects.append(_headers(stream))
                stream.sendall(b"HTTP/1.1 200 Connection established\r\n\r\n")
            if self.target_scheme == "https":
                stream = _NestedTLS(stream, self.context) if self.proxy_scheme == "https" else self.context.wrap_socket(stream, server_side=True)
            request = _headers(stream)
            self.requests.append(request)
            path = request.split(b" ", 2)[1].decode()
            status, headers, body = self.reply(path)
            response = f"HTTP/1.1 {status} Test\r\nContent-Length: {len(body)}\r\nConnection: close\r\n"
            response += "".join(f"{key}: {value}\r\n" for key, value in headers.items())
            stream.sendall(response.encode() + b"\r\n" + body)
        except Exception as error:
            if not self.stopped.is_set():
                self.errors.append(type(error).__name__)
        finally:
            connection.close()

    def close(self):
        self.stopped.set()
        self.listener.close()
        self.thread.join(timeout=2)
        for thread in self.clients:
            thread.join(timeout=6)
            assert not thread.is_alive()
        assert not self.thread.is_alive()


@pytest.fixture
def curl_wire(monkeypatch, tmp_path):
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    subject = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "Public curl fixture")])
    cert = (x509.CertificateBuilder().subject_name(subject).issuer_name(subject)
            .public_key(key.public_key()).serial_number(x509.random_serial_number())
            .not_valid_before(datetime.now(UTC) - timedelta(days=1))
            .not_valid_after(datetime.now(UTC) + timedelta(days=1))
            .add_extension(x509.SubjectAlternativeName([x509.DNSName(name) for name in ("source.test", "alternate.test", "proxy.test", "xn--bcher-kva.test")]), critical=False)
            .add_extension(x509.BasicConstraints(ca=True, path_length=None), critical=True)
            .sign(key, hashes.SHA256()))
    cert_path, key_path = tmp_path / "ca.pem", tmp_path / "key.pem"
    cert_path.write_bytes(cert.public_bytes(serialization.Encoding.PEM))
    key_path.write_bytes(key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()))
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    context.load_cert_chain(cert_path, key_path)
    context.set_alpn_protocols(["http/1.1"])
    sni, lookups, servers = [], [], []
    context.set_servername_callback(lambda sock, name, ctx: sni.append(name))
    actual_resolve, actual_session = security.resolve_public_http_url_sync, security.curl_requests.Session

    def resolve(url):
        parsed = urlsplit(url)
        lookups.append(parsed.hostname)
        if parsed.hostname in {"source.test", "alternate.test", "xn--bcher-kva.test"}:
            return parsed.hostname, parsed.port or (443 if parsed.scheme == "https" else 80), "127.0.0.1"
        return actual_resolve(url)  # private redirect targets retain the real policy

    def session(**kwargs):
        kwargs["verify"] = str(cert_path)
        kwargs["curl_options"][CurlOpt.PROXY_CAINFO] = str(cert_path)
        if proxy := kwargs["curl_options"].get(CurlOpt.PROXY):
            parsed = urlsplit(proxy)
            if parsed.hostname == "proxy.test":
                kwargs["curl_options"][CurlOpt.RESOLVE] = [f"proxy.test:{parsed.port}:127.0.0.1"]
        return actual_session(**kwargs)

    monkeypatch.setattr(security, "resolve_public_http_url_sync", resolve)
    monkeypatch.setattr(security.curl_requests, "Session", session)
    # Ambient proxies and bypass variables may not affect the boundary.
    monkeypatch.setenv("HTTPS_PROXY", "http://169.254.169.254:1")
    monkeypatch.setenv("NO_PROXY", "*")

    def start(**kwargs):
        server = WireServer(context, **kwargs)
        servers.append(server)
        return server

    yield start, sni, lookups
    for server in servers:
        server.close()


def browser_request(downloader, url, **kwargs):
    target = next(target for target in public.PublicRH.supported_targets if target.client == "chrome")
    return downloader.urlopen(Request(url, extensions={"impersonate": target}, **kwargs))


def test_native_owner_is_closed_on_streaming_error():
    closed = []

    def broken_body():
        raise CurlRequestError("Synthetic body failure")
        yield b""

    raw = SimpleNamespace(
        headers={}, url="https://public.example/source", status_code=200, reason="OK",
        iter_content=broken_body, close=lambda: closed.append("response"),
    )
    response = public._PublicCurlResponse(raw, SimpleNamespace(close=lambda: closed.append("owner")))
    with pytest.raises(TransportError):
        response.read()
    assert "response" in closed and "owner" in closed


@pytest.mark.parametrize("proxy_scheme", [None, "http", "https"])
def test_native_browser_tls_identity_and_proxy_connect_are_pinned(curl_wire, proxy_scheme):
    start, sni, lookups = curl_wire
    server = start(proxy_scheme=proxy_scheme)
    proxy = f"{proxy_scheme}://user:secret@proxy.test:{server.port}" if proxy_scheme else None
    url = "https://source.test:443/caption" if proxy else f"https://source.test:{server.port}/caption"
    with public.PublicYoutubeDL({"quiet": True, "proxy": proxy}) as downloader:
        with browser_request(downloader, url) as response:
            assert response.read() == b"caption" and httpx.URL(response.url) == httpx.URL(url)
            assert response.extensions["impersonate"].client == "chrome"
    assert lookups == ["source.test"]
    assert sni == (["proxy.test", "source.test"] if proxy_scheme == "https" else ["source.test"])
    assert not server.errors
    assert b"Chrome/" in server.requests[0]
    assert b"Host: source.test" in server.requests[0]
    assert b"Proxy-Authorization" not in server.requests[0]
    if proxy:
        assert server.connects[0].startswith(b"CONNECT 127.0.0.1:443 HTTP/1.1\r\n")
        assert b"Proxy-Authorization: Basic " in server.connects[0]


@pytest.mark.parametrize("proxy_scheme", ["http", "https"])
def test_plain_http_uses_a_literal_ip_tunnel_instead_of_forwarding_host(curl_wire, proxy_scheme):
    start, sni, _ = curl_wire
    server = start(proxy_scheme=proxy_scheme, target_scheme="http")
    with public.PublicYoutubeDL({"quiet": True, "proxy": f"{proxy_scheme}://proxy.test:{server.port}"}) as downloader:
        with browser_request(downloader, "http://source.test/caption") as response:
            assert response.read() == b"caption"
    assert server.connects[0].startswith(b"CONNECT 127.0.0.1:80 HTTP/1.1\r\n")
    assert server.requests[0].startswith(b"GET /caption HTTP/1.1\r\n")
    assert sni == (["proxy.test"] if proxy_scheme == "https" else [])
    assert not server.errors


def test_native_proxy_connect_brackets_a_pinned_ipv6_target(curl_wire, monkeypatch):
    start, sni, _ = curl_wire
    server = start(proxy_scheme="http")
    resolve = security.resolve_public_http_url_sync

    def ipv6_target(url):
        hostname, port, _ = resolve(url)
        return hostname, port, "::1"

    monkeypatch.setattr(security, "resolve_public_http_url_sync", ipv6_target)
    with public.PublicYoutubeDL({"quiet": True, "proxy": f"http://proxy.test:{server.port}"}) as downloader:
        with browser_request(downloader, "https://source.test/caption") as response:
            assert response.read() == b"caption"
    assert server.connects[0].startswith(b"CONNECT [::1]:443 HTTP/1.1\r\n")
    assert sni == ["source.test"] and not server.errors


def test_native_target_certificate_identity_is_enforced(curl_wire, monkeypatch):
    start, sni, _ = curl_wire
    server = start()
    resolve = security.resolve_public_http_url_sync

    def wrong_certificate(url):
        parsed = urlsplit(url)
        if parsed.hostname == "wrong.test":
            return parsed.hostname, parsed.port, "127.0.0.1"
        return resolve(url)

    monkeypatch.setattr(security, "resolve_public_http_url_sync", wrong_certificate)
    with public.PublicYoutubeDL({"quiet": True}) as downloader, pytest.raises(RequestError):
        browser_request(downloader, f"https://wrong.test:{server.port}/caption")
    assert sni == ["wrong.test"] and not server.requests


def test_native_redirects_revalidate_and_preserve_cookie_identity(curl_wire):
    start, sni, lookups = curl_wire

    def reply(path):
        return (302, {"Location": "/caption", "Set-Cookie": "session=synthetic; Secure; Path=/"}, b"") if path == "/start" else (200, {}, b"caption")

    server = start(reply=reply)
    with public.PublicYoutubeDL({"quiet": True}) as downloader:
        with browser_request(downloader, f"https://source.test:{server.port}/start") as response:
            assert response.read() == b"caption"
    assert lookups == ["source.test", "source.test"] and sni == ["source.test", "source.test"]
    assert len(server.requests) == 2 and b"session=synthetic" in server.requests[1]
    assert not server.errors


@pytest.mark.parametrize("hostname,expected", [("bücher.test", "xn--bcher-kva.test"), ("source.test.", "source.test")])
def test_curl_and_policy_use_identical_canonical_hostnames(curl_wire, hostname, expected):
    start, sni, lookups = curl_wire
    server = start()
    with public.PublicYoutubeDL({"quiet": True}) as downloader:
        with browser_request(downloader, f"https://{hostname}:{server.port}/caption") as response:
            assert response.read() == b"caption"
    assert lookups == [expected] and sni == [expected]
    assert not server.errors


def test_native_redirect_to_private_address_never_connects(curl_wire):
    start, _, lookups = curl_wire
    server = start(reply=lambda path: (302, {"Location": "http://169.254.169.254/latest/meta-data"}, b""))
    with public.PublicYoutubeDL({"quiet": True}) as downloader, pytest.raises(RequestError):
        browser_request(downloader, f"https://source.test:{server.port}/start")
    assert lookups == ["source.test", "169.254.169.254"]
    assert len(server.requests) == 1 and not server.errors


def test_native_cross_origin_redirect_does_not_forward_cookie_or_authorization(curl_wire):
    start, sni, lookups = curl_wire
    server = start()
    server.reply = lambda path: (
        (302, {"Location": f"https://alternate.test:{server.port}/caption"}, b"")
        if path == "/start" else (200, {}, b"caption")
    )
    with public.PublicYoutubeDL({"quiet": True}) as downloader:
        with browser_request(
            downloader, f"https://source.test:{server.port}/start",
            headers={"Authorization": "Bearer synthetic", "Cookie": "private=synthetic"},
        ) as response:
            assert response.read() == b"caption"
    first, second = [request.lower() for request in server.requests]
    assert b"authorization:" in first and b"private=synthetic" in first
    assert b"authorization:" not in second and b"private=synthetic" not in second
    assert lookups == ["source.test", "alternate.test"] and sni == lookups
    assert not server.errors


def test_native_mixed_dns_stops_before_constructing_curl(monkeypatch):
    def resolve(hostname, port):
        return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", (address, port)) for address in ("93.184.216.34", "10.0.0.1")]

    def unexpected_session(**kwargs):
        pytest.fail("A non-public destination reached libcurl")

    monkeypatch.setattr(security.socket, "getaddrinfo", resolve)
    monkeypatch.setattr(security.curl_requests, "Session", unexpected_session)
    with public.PublicYoutubeDL({"quiet": True}) as downloader, pytest.raises(RequestError):
        browser_request(downloader, "https://public.example/source")


@pytest.mark.parametrize("kind", ["segment", "key"])
def test_impersonating_native_hls_does_not_connect_to_private_segments_or_keys(curl_wire, tmp_path, kind):
    start, _, lookups = curl_wire
    private = "http://169.254.169.254/latest/meta-data"
    key = f'#EXT-X-KEY:METHOD=AES-128,URI="{private}"\n' if kind == "key" else ""
    segment = private if kind == "segment" else "segment.ts"
    manifest = f"#EXTM3U\n#EXT-X-TARGETDURATION:1\n{key}#EXTINF:1,\n{segment}\n#EXT-X-ENDLIST\n".encode()
    server = start(reply=lambda path: (200, {}, manifest if path == "/playlist" else b"x" * 16))
    target = next(target for target in public.PublicRH.supported_targets if target.client == "chrome")
    with public.PublicYoutubeDL({
        "quiet": True, "noprogress": True, "fixup": "never", "retries": 0, "fragment_retries": 0,
        "outtmpl": str(tmp_path / "result.mp4"), "external_downloader": {"default": "native"}, "impersonate": target,
    }, auto_init=False) as downloader, pytest.raises(RequestError):
        downloader.process_ie_result({
            "id": "fixture", "title": "Local fixture", "ext": "mp4", "protocol": "m3u8_native",
            "url": f"https://source.test:{server.port}/playlist",
        })
    assert "169.254.169.254" in lookups
    assert len(server.requests) == (1 if kind == "segment" else 2)
    assert not server.errors
