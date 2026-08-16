"""Small, issuer-scoped client for the Clerk Backend API."""

from dataclasses import dataclass
from urllib.parse import quote

import httpx

from app.config import ClerkEnvironment

CLERK_API_BASE_URL = "https://api.clerk.com/v1"


@dataclass(frozen=True)
class ClerkProfile:
    clerk_user_id: str
    email: str
    email_verified: bool
    first_name: str | None
    last_name: str | None
    external_id: str | None


def parse_clerk_profile(payload: object) -> ClerkProfile | None:
    """Return only a profile with a well-formed primary email record."""
    if not isinstance(payload, dict):
        return None

    clerk_user_id = str(payload.get("id") or "").strip()
    primary_id = str(payload.get("primary_email_address_id") or "").strip()
    if not clerk_user_id or not primary_id:
        return None

    email_records = payload.get("email_addresses")
    if not isinstance(email_records, list):
        return None
    primary = next(
        (
            item
            for item in email_records
            if isinstance(item, dict) and str(item.get("id") or "") == primary_id
        ),
        None,
    )
    if primary is None:
        return None

    email = str(primary.get("email_address") or "").strip().lower()
    verification = primary.get("verification")
    verified = (
        isinstance(verification, dict)
        and verification.get("status") == "verified"
    )
    if not email:
        return None

    return ClerkProfile(
        clerk_user_id=clerk_user_id,
        email=email,
        email_verified=verified,
        first_name=str(payload.get("first_name") or "").strip() or None,
        last_name=str(payload.get("last_name") or "").strip() or None,
        external_id=str(payload.get("external_id") or "").strip() or None,
    )


class ClerkBackendClient:
    """Backend API operations bound to one configured Clerk instance."""

    def __init__(self, environment: ClerkEnvironment, *, timeout: float = 10.0):
        if not environment.secret_key:
            raise ValueError(f"Missing Clerk secret for {environment.name}")
        self.environment = environment
        self.timeout = timeout

    @property
    def _headers(self) -> dict[str, str]:
        return {
            "Authorization": f"Bearer {self.environment.secret_key}",
            "Content-Type": "application/json",
        }

    async def get_user(self, clerk_user_id: str) -> ClerkProfile | None:
        if not clerk_user_id or not clerk_user_id.replace("_", "").replace("-", "").isalnum():
            return None
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            response = await client.get(
                f"{CLERK_API_BASE_URL}/users/{quote(clerk_user_id, safe='')}",
                headers=self._headers,
            )
        if response.status_code != 200:
            return None
        return parse_clerk_profile(response.json())

    async def list_users(self) -> list[ClerkProfile]:
        profiles: list[ClerkProfile] = []
        offset = 0
        limit = 100
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            while True:
                response = await client.get(
                    f"{CLERK_API_BASE_URL}/users",
                    headers=self._headers,
                    params={"limit": limit, "offset": offset},
                )
                response.raise_for_status()
                payload = response.json()
                if not isinstance(payload, list):
                    raise RuntimeError("Clerk user inventory returned an unexpected response")
                for item in payload:
                    profile = parse_clerk_profile(item)
                    if profile:
                        profiles.append(profile)
                if len(payload) < limit:
                    break
                offset += limit
        return profiles

    async def create_user(
        self,
        *,
        email: str,
        external_id: str,
        first_name: str | None,
        last_name: str | None,
    ) -> ClerkProfile | None:
        body = {
            "email_address": [email],
            "external_id": external_id,
            "skip_password_requirement": True,
        }
        if first_name:
            body["first_name"] = first_name
        if last_name:
            body["last_name"] = last_name

        async with httpx.AsyncClient(timeout=self.timeout) as client:
            response = await client.post(
                f"{CLERK_API_BASE_URL}/users",
                headers=self._headers,
                json=body,
            )
        if response.status_code not in {200, 201}:
            return None
        return parse_clerk_profile(response.json())

    async def set_external_id(
        self,
        clerk_user_id: str,
        external_id: str,
    ) -> ClerkProfile | None:
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            response = await client.patch(
                f"{CLERK_API_BASE_URL}/users/{quote(clerk_user_id, safe='')}",
                headers=self._headers,
                json={"external_id": external_id},
            )
        if response.status_code != 200:
            return None
        return parse_clerk_profile(response.json())

    async def create_sign_in_token(
        self,
        clerk_user_id: str,
        *,
        expires_in_seconds: int = 60,
    ) -> str:
        """Create a short-lived, one-use Clerk ticket for a known user."""
        if (
            not clerk_user_id
            or not clerk_user_id.replace("_", "").replace("-", "").isalnum()
            or not 1 <= expires_in_seconds <= 300
        ):
            raise ValueError("Invalid sign-in token request")

        async with httpx.AsyncClient(timeout=self.timeout) as client:
            response = await client.post(
                f"{CLERK_API_BASE_URL}/sign_in_tokens",
                headers=self._headers,
                json={
                    "user_id": clerk_user_id,
                    "expires_in_seconds": expires_in_seconds,
                },
            )
        response.raise_for_status()
        payload = response.json()
        token = str(payload.get("token") or "") if isinstance(payload, dict) else ""
        if not token or len(token) > 16 * 1024:
            raise RuntimeError("Clerk returned an invalid sign-in token response")
        return token

    async def delete_user(self, clerk_user_id: str) -> bool:
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            response = await client.delete(
                f"{CLERK_API_BASE_URL}/users/{quote(clerk_user_id, safe='')}",
                headers=self._headers,
            )
        return response.status_code in {200, 204, 404}
