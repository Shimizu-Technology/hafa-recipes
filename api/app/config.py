from dataclasses import dataclass
from functools import lru_cache
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from pydantic import Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

UNSUPPORTED_ASYNCPG_QUERY_PARAMS = frozenset({"sslmode", "channel_binding"})


@dataclass(frozen=True)
class ClerkEnvironment:
    """Credentials and verification policy for one exact Clerk issuer."""

    name: str
    issuer: str
    secret_key: str | None
    jwks_url: str
    audience: str | list[str] | None
    authorized_parties: tuple[str, ...]
    require_authorized_party: bool = False

    @property
    def is_development(self) -> bool:
        return self.name in {"development", "legacy"}

    @property
    def is_production(self) -> bool:
        return self.name == "production"


class Settings(BaseSettings):
    """Application settings loaded from environment variables."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )
    
    # Database
    database_url: str
    database_use_ssl: bool = True
    
    # OpenAI
    openai_api_key: str

    # AI capability registry. Model IDs are pinned so a provider alias cannot
    # silently change behavior. Luna handles routine work; Terra is reserved
    # for deterministic fallback after a failed/invalid result.
    recipe_extraction_model: str = "gpt-5.6-luna"
    recipe_extraction_fallback_model: str = "gpt-5.6-terra"
    ocr_model: str = "gpt-5.6-luna"
    ocr_fallback_model: str = "gpt-5.6-terra"
    recipe_chat_model: str = "gpt-5.6-luna"
    cooking_chat_model: str = "gpt-5.6-luna"
    enrichment_model: str = "gpt-5.6-luna"
    transcription_model: str = "whisper-1"
    tts_model: str = "tts-1"
    openai_reasoning_effort: str = "none"
    ai_disabled_capabilities: str = ""
    ai_canary_models: dict[str, str] = Field(default_factory=dict)
    ai_canary_percentages: dict[str, int] = Field(default_factory=dict)
    ai_model_pricing: dict[str, dict[str, float]] = Field(
        default_factory=lambda: {
            "gpt-5.6-luna": {
                "input_per_million": 0.20,
                "cached_input_per_million": 0.02,
                "output_per_million": 1.20,
            },
            "gpt-5.6-terra": {
                "input_per_million": 2.00,
                "cached_input_per_million": 0.20,
                "output_per_million": 12.00,
            },
        }
    )
    
    # Clerk Auth
    clerk_secret_key: str | None = None
    clerk_frontend_api: str | None = None  # e.g., "prepared-mole-42.clerk.accounts.dev"
    clerk_jwt_issuer: str | None = None
    clerk_jwt_audience: str | None = None
    clerk_authorized_parties: str = ""

    # Explicit issuer-scoped settings used during the production transition.
    # Legacy CLERK_* settings above remain supported so the foundation can be
    # deployed before changing any production credentials.
    clerk_development_issuer: str | None = None
    clerk_development_secret_key: str | None = None
    clerk_development_jwks_url: str | None = None
    clerk_development_audience: str | None = None
    clerk_development_authorized_parties: str = ""
    clerk_development_require_authorized_party: bool = False
    clerk_production_issuer: str | None = None
    clerk_production_secret_key: str | None = None
    clerk_production_jwks_url: str | None = None
    clerk_production_audience: str | None = None
    clerk_production_authorized_parties: str = ""
    clerk_production_require_authorized_party: bool = False
    clerk_primary_environment: str = "development"
    
    # AWS S3 (for thumbnail storage)
    aws_access_key_id: str | None = None
    aws_secret_access_key: str | None = None
    aws_region: str = "us-east-1"
    s3_bucket_name: str | None = None
    
    # Optional
    ig_oembed_token: str | None = None
    
    # Instagram cookies (for yt-dlp authentication)
    # Can be either a file path or the raw cookie content
    instagram_cookies: str | None = None
    
    # YouTube proxy (required for cloud hosting)
    # YouTube blocks datacenter IPs, so a residential proxy is needed
    # Format: http://username:password@p.webshare.io:80
    youtube_proxy: str | None = None
    video_download_timeout_seconds: int = 120
    video_metadata_timeout_seconds: int = 30
    video_max_duration_seconds: int = 3_600
    audio_max_bytes: int = 25 * 1024 * 1024

    # Durable database-backed extraction worker
    job_worker_enabled: bool = True
    job_worker_poll_seconds: float = 5.0
    job_lease_seconds: int = 600
    job_max_attempts: int = 3
    job_expiry_hours: int = 24

    # Durable account/recipe external cleanup worker
    deletion_cleanup_worker_enabled: bool = True
    deletion_cleanup_poll_seconds: float = 10.0
    deletion_cleanup_lease_seconds: int = 300
    deletion_cleanup_max_attempts: int = 20
    
    # Sentry error monitoring
    sentry_dsn: str | None = None

    # Environment
    environment: str = "development"
    cors_origins: str = ""
    enable_sentry_debug: bool = False
    
    # API Settings
    api_title: str = "Recipe Extractor API"
    api_version: str = "1.0.0"

    @model_validator(mode="after")
    def validate_ai_registry(self) -> "Settings":
        """Reject missing, retired, or unsafe active model configuration."""
        configured_models = {
            "recipe_extraction": self.recipe_extraction_model,
            "recipe_extraction_fallback": self.recipe_extraction_fallback_model,
            "ocr": self.ocr_model,
            "ocr_fallback": self.ocr_fallback_model,
            "recipe_chat": self.recipe_chat_model,
            "cooking_chat": self.cooking_chat_model,
            "enrichment": self.enrichment_model,
            "transcription": self.transcription_model,
            "tts": self.tts_model,
        }
        for capability, model_id in configured_models.items():
            normalized = model_id.strip().lower()
            if not normalized:
                raise ValueError(f"{capability} model ID is required")
            if "gemini-2." in normalized or normalized.startswith("gpt-4o"):
                raise ValueError(f"{capability} uses a retired or deprecated model")

        if self.openai_reasoning_effort not in {"none", "low", "medium", "high", "xhigh"}:
            raise ValueError("OPENAI_REASONING_EFFORT must be none, low, medium, high, or xhigh")
        supported_canary_capabilities = {
            "recipe_extraction",
            "ocr",
            "recipe_chat",
            "cooking_chat",
            "enrichment",
            "transcription",
            "tts",
        }
        unknown_canary_capabilities = (
            set(self.ai_canary_models) | set(self.ai_canary_percentages)
        ) - supported_canary_capabilities
        if unknown_canary_capabilities:
            raise ValueError(
                "Unknown AI canary capabilities: "
                + ", ".join(sorted(unknown_canary_capabilities))
            )
        for capability, percentage in self.ai_canary_percentages.items():
            if percentage < 0 or percentage > 100:
                raise ValueError(f"AI canary percentage for {capability} must be between 0 and 100")
            if percentage and not self.ai_canary_models.get(capability, "").strip():
                raise ValueError(f"AI canary model for {capability} is required when rollout is enabled")
        for capability, model_id in self.ai_canary_models.items():
            normalized = model_id.strip().lower()
            if not normalized:
                raise ValueError(f"AI canary model for {capability} cannot be empty")
            if "gemini-2." in normalized or normalized.startswith("gpt-4o"):
                raise ValueError(f"AI canary for {capability} uses a retired or deprecated model")
        for model_id, prices in self.ai_model_pricing.items():
            if not model_id.strip():
                raise ValueError("AI pricing model IDs cannot be empty")
            required_prices = {"input_per_million", "output_per_million"}
            if not required_prices.issubset(prices):
                raise ValueError(f"AI pricing for {model_id} is missing required token rates")
            if any(price < 0 for price in prices.values()):
                raise ValueError(f"AI pricing for {model_id} cannot contain negative rates")
        if self.job_worker_poll_seconds <= 0:
            raise ValueError("JOB_WORKER_POLL_SECONDS must be positive")
        if self.job_lease_seconds < 60:
            raise ValueError("JOB_LEASE_SECONDS must be at least 60")
        if self.job_max_attempts < 1:
            raise ValueError("JOB_MAX_ATTEMPTS must be at least 1")
        if self.job_expiry_hours < 1:
            raise ValueError("JOB_EXPIRY_HOURS must be at least 1")
        if self.deletion_cleanup_poll_seconds <= 0:
            raise ValueError("DELETION_CLEANUP_POLL_SECONDS must be positive")
        if self.deletion_cleanup_lease_seconds < 60:
            raise ValueError("DELETION_CLEANUP_LEASE_SECONDS must be at least 60")
        if self.deletion_cleanup_max_attempts < 1:
            raise ValueError("DELETION_CLEANUP_MAX_ATTEMPTS must be at least 1")
        if not self.database_use_ssl:
            parsed_database_url = urlsplit(self.database_url)
            database_host = parsed_database_url.hostname
            local_database_hosts = {"localhost", "127.0.0.1", "::1"}
            query_parameters = parse_qsl(
                parsed_database_url.query,
                keep_blank_values=True,
            )
            query_hosts = [
                value for key, value in query_parameters if key.lower() == "host"
            ]
            query_host_addresses = [
                value
                for key, value in query_parameters
                if key.lower() == "hostaddr"
            ]
            query_hosts_are_local = all(
                host in {"localhost", "127.0.0.1", "::1"} or host.startswith("/")
                for host in query_hosts
            )
            query_host_addresses_are_local = all(
                address in {"127.0.0.1", "::1"}
                for address in query_host_addresses
            )
            uses_service_routing = any(
                key.lower() in {"service", "servicefile"}
                for key, _value in query_parameters
            )
            has_explicit_query_target = bool(query_hosts or query_host_addresses)
            has_explicit_local_target = (
                database_host in local_database_hosts
                or (database_host is None and has_explicit_query_target)
            )
            if (
                self.environment.lower() != "development"
                or not has_explicit_local_target
                or not query_hosts_are_local
                or not query_host_addresses_are_local
                or uses_service_routing
            ):
                raise ValueError(
                    "DATABASE_USE_SSL can only be disabled for a local development database"
                )
        return self

    @property
    def disabled_ai_capability_set(self) -> set[str]:
        """Capabilities disabled through the emergency runtime kill switch."""
        return {
            capability.strip().lower()
            for capability in self.ai_disabled_capabilities.split(",")
            if capability.strip()
        }

    def is_ai_capability_enabled(self, capability: str) -> bool:
        """Return whether a capability is allowed to call a paid provider."""
        disabled = self.disabled_ai_capability_set
        return "all" not in disabled and capability.lower() not in disabled
    
    @property
    def s3_enabled(self) -> bool:
        """Check if S3 is configured."""
        return all([
            self.aws_access_key_id,
            self.aws_secret_access_key,
            self.s3_bucket_name
        ])

    @property
    def clerk_issuer(self) -> str:
        """Expected Clerk JWT issuer."""
        if self.clerk_jwt_issuer:
            return self.clerk_jwt_issuer.rstrip("/")
        frontend_api = (self.clerk_frontend_api or "").rstrip("/")
        if not frontend_api:
            return ""
        if frontend_api.startswith("http://") or frontend_api.startswith("https://"):
            return frontend_api
        return f"https://{frontend_api}"

    @property
    def jwks_url(self) -> str:
        """Clerk JWKS endpoint."""
        return f"{self.clerk_issuer}/.well-known/jwks.json"

    @staticmethod
    def _parse_csv(value: str) -> tuple[str, ...]:
        return tuple(item.strip() for item in value.split(",") if item.strip())

    @staticmethod
    def _parse_audience(value: str | None) -> str | list[str] | None:
        values = [item.strip() for item in (value or "").split(",") if item.strip()]
        if not values:
            return None
        return values[0] if len(values) == 1 else values

    @property
    def clerk_environments(self) -> tuple[ClerkEnvironment, ...]:
        """Return configured Clerk instances, deduplicated by exact issuer."""
        environments: list[ClerkEnvironment] = []

        explicit = (
            (
                "development",
                self.clerk_development_issuer,
                self.clerk_development_secret_key,
                self.clerk_development_jwks_url,
                self.clerk_development_audience,
                self.clerk_development_authorized_parties,
                self.clerk_development_require_authorized_party,
            ),
            (
                "production",
                self.clerk_production_issuer,
                self.clerk_production_secret_key,
                self.clerk_production_jwks_url,
                self.clerk_production_audience,
                self.clerk_production_authorized_parties,
                self.clerk_production_require_authorized_party,
            ),
        )
        for name, issuer, secret, jwks, audience, parties, require_party in explicit:
            normalized = (issuer or "").strip().rstrip("/")
            if normalized:
                environments.append(
                    ClerkEnvironment(
                        name=name,
                        issuer=normalized,
                        secret_key=secret,
                        jwks_url=(jwks or f"{normalized}/.well-known/jwks.json").strip(),
                        audience=self._parse_audience(audience),
                        authorized_parties=self._parse_csv(parties),
                        require_authorized_party=require_party,
                    )
                )

        legacy_issuer = self.clerk_issuer.strip().rstrip("/")
        if legacy_issuer and all(item.issuer != legacy_issuer for item in environments):
            environments.append(
                ClerkEnvironment(
                    name="legacy",
                    issuer=legacy_issuer,
                    secret_key=self.clerk_secret_key,
                    jwks_url=self.jwks_url,
                    audience=self._parse_audience(self.clerk_jwt_audience),
                    authorized_parties=self._parse_csv(self.clerk_authorized_parties),
                    require_authorized_party=False,
                )
            )

        return tuple(environments)

    def clerk_environment_for_issuer(self, issuer: str | None) -> ClerkEnvironment | None:
        normalized = (issuer or "").strip().rstrip("/")
        return next((item for item in self.clerk_environments if item.issuer == normalized), None)

    @property
    def primary_clerk_environment(self) -> ClerkEnvironment | None:
        preferred = self.clerk_primary_environment.strip().lower()
        environments = self.clerk_environments
        return (
            next((item for item in environments if item.name == preferred), None)
            or next((item for item in environments if item.is_development), None)
            or next(iter(environments), None)
        )

    @property
    def allowed_cors_origins(self) -> list[str]:
        """Allowed browser origins for CORS."""
        if self.cors_origins:
            return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]

        if self.environment.lower() == "development":
            return ["*"]

        return [
            "https://hafa-recipes.com",
            "https://www.hafa-recipes.com",
        ]
    
    @property
    def async_database_url(self) -> str:
        """Convert database URL to async format for SQLAlchemy."""
        url = self.database_url
        # Convert to asyncpg driver
        if url.startswith("postgres://"):
            url = url.replace("postgres://", "postgresql+asyncpg://", 1)
        elif url.startswith("postgresql://"):
            url = url.replace("postgresql://", "postgresql+asyncpg://", 1)
        # Remove libpq/psycopg SSL parameters that asyncpg does not accept as
        # keyword arguments. SSL is configured explicitly in app.db.database.
        parts = urlsplit(url)
        query_params = [
            (key, value)
            for key, value in parse_qsl(parts.query, keep_blank_values=True)
            if key.lower() not in UNSUPPORTED_ASYNCPG_QUERY_PARAMS
        ]
        return urlunsplit(parts._replace(query=urlencode(query_params)))


@lru_cache
def get_settings() -> Settings:
    """Get cached settings instance."""
    return Settings()
