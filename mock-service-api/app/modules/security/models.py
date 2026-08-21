from __future__ import annotations

from datetime import datetime
from enum import StrEnum

from pydantic import Field, field_validator

from app.schemas import APIModel


class Role(StrEnum):
    ADMIN = "admin"
    USER_A = "user_a"
    USER_B = "user_b"


class Severity(StrEnum):
    CRITICAL = "critical"
    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"
    INFO = "info"


class WorkflowStatus(StrEnum):
    NO_RESPONSE = "no_response"
    RESPONDING = "responding"
    CLOSED = "closed"


class AssetType(StrEnum):
    SERVER = "server"
    NETWORK_DEVICE = "network_device"
    DATABASE = "database"
    CLOUD = "cloud"
    CONTAINER = "container"
    APPLICATION = "application"
    ENDPOINT = "endpoint"
    OTHER = "other"


class Criticality(StrEnum):
    CRITICAL = "critical"
    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"


class Exposure(StrEnum):
    INTERNET = "internet"
    INTRANET = "intranet"
    ISOLATED = "isolated"


class AssetStatus(StrEnum):
    ACTIVE = "active"
    OFFLINE = "offline"
    RETIRED = "retired"


class LoginRequest(APIModel):
    username: str = Field(min_length=3, max_length=50, examples=["admin"])
    password: str = Field(min_length=8, max_length=128, examples=["Admin@123"])


class TokenResponse(APIModel):
    access_token: str
    token_type: str = "bearer"
    expires_at: int = Field(description="Unix 时间戳")


class PasswordChange(APIModel):
    current_password: str = Field(min_length=8, max_length=128)
    new_password: str = Field(min_length=8, max_length=128)


class PasswordReset(APIModel):
    new_password: str = Field(min_length=8, max_length=128)


class UserBase(APIModel):
    username: str = Field(min_length=3, max_length=50, pattern=r"^[A-Za-z0-9_.-]+$")
    name: str = Field(min_length=1, max_length=100)
    nickname: str | None = Field(default=None, max_length=100)
    phone: str | None = Field(default=None, max_length=30)
    email: str | None = Field(default=None, max_length=254)
    department: str | None = Field(default=None, max_length=100)
    job_title: str | None = Field(default=None, max_length=100)

    @field_validator("email")
    @classmethod
    def validate_email(cls, value: str | None) -> str | None:
        if value is not None:
            parts = value.rsplit("@", 1)
            if len(parts) != 2 or not parts[0] or "." not in parts[1]:
                raise ValueError("邮箱格式不正确")
        return value


class UserCreate(UserBase):
    password: str = Field(min_length=8, max_length=128)
    role: Role = Role.USER_B
    is_active: bool = True


class UserUpdate(APIModel):
    name: str | None = Field(default=None, min_length=1, max_length=100)
    nickname: str | None = Field(default=None, max_length=100)
    phone: str | None = Field(default=None, max_length=30)
    email: str | None = Field(default=None, max_length=254)
    department: str | None = Field(default=None, max_length=100)
    job_title: str | None = Field(default=None, max_length=100)
    role: Role | None = None
    is_active: bool | None = None

    @field_validator("email")
    @classmethod
    def validate_email(cls, value: str | None) -> str | None:
        if value is not None:
            parts = value.rsplit("@", 1)
            if len(parts) != 2 or not parts[0] or "." not in parts[1]:
                raise ValueError("邮箱格式不正确")
        return value


class UserRead(APIModel):
    id: int
    username: str
    name: str
    nickname: str | None
    phone: str | None
    email: str | None
    department: str | None
    job_title: str | None
    role: Role
    is_active: bool
    last_login_at: datetime | None
    created_at: datetime
    updated_at: datetime


class AssetBase(APIModel):
    asset_code: str = Field(min_length=1, max_length=64, examples=["ASSET-001"])
    name: str = Field(min_length=1, max_length=200)
    asset_type: AssetType
    ip_address: str | None = Field(default=None, max_length=45)
    hostname: str | None = Field(default=None, max_length=255)
    mac_address: str | None = Field(default=None, max_length=32)
    operating_system: str | None = Field(default=None, max_length=200)
    vendor: str | None = Field(default=None, max_length=100)
    model: str | None = Field(default=None, max_length=100)
    location: str | None = Field(default=None, max_length=200)
    department: str | None = Field(default=None, max_length=100)
    owner_id: int | None = Field(default=None, gt=0)
    criticality: Criticality = Criticality.MEDIUM
    exposure: Exposure = Exposure.INTRANET
    security_zone: str | None = Field(default=None, max_length=100)
    status: AssetStatus = AssetStatus.ACTIVE
    description: str | None = Field(default=None, max_length=4000)
    tags: list[str] = Field(default_factory=list, max_length=50)


class AssetCreate(AssetBase):
    pass


class AssetUpdate(APIModel):
    asset_code: str | None = Field(default=None, min_length=1, max_length=64)
    name: str | None = Field(default=None, min_length=1, max_length=200)
    asset_type: AssetType | None = None
    ip_address: str | None = Field(default=None, max_length=45)
    hostname: str | None = Field(default=None, max_length=255)
    mac_address: str | None = Field(default=None, max_length=32)
    operating_system: str | None = Field(default=None, max_length=200)
    vendor: str | None = Field(default=None, max_length=100)
    model: str | None = Field(default=None, max_length=100)
    location: str | None = Field(default=None, max_length=200)
    department: str | None = Field(default=None, max_length=100)
    owner_id: int | None = Field(default=None, gt=0)
    criticality: Criticality | None = None
    exposure: Exposure | None = None
    security_zone: str | None = Field(default=None, max_length=100)
    status: AssetStatus | None = None
    description: str | None = Field(default=None, max_length=4000)
    tags: list[str] | None = Field(default=None, max_length=50)


class AssetRead(AssetBase):
    id: int
    created_at: datetime
    updated_at: datetime


class VulnerabilityBase(APIModel):
    vuln_code: str = Field(min_length=1, max_length=64, examples=["VULN-001"])
    name: str = Field(min_length=1, max_length=300)
    cve_id: str | None = Field(default=None, max_length=32)
    cnnvd_id: str | None = Field(default=None, max_length=32)
    severity: Severity
    cvss_score: float | None = Field(default=None, ge=0, le=10)
    vuln_type: str | None = Field(default=None, max_length=100)
    source: str | None = Field(default=None, max_length=100)
    description: str | None = Field(default=None, max_length=10_000)
    solution: str | None = Field(default=None, max_length=10_000)
    discovered_at: datetime
    due_at: datetime | None = None
    status: WorkflowStatus = WorkflowStatus.NO_RESPONSE
    assignee_id: int | None = Field(default=None, gt=0)
    closed_at: datetime | None = None
    asset_ids: list[int] = Field(default_factory=list, max_length=500)


class VulnerabilityCreate(VulnerabilityBase):
    pass


class VulnerabilityUpdate(APIModel):
    vuln_code: str | None = Field(default=None, min_length=1, max_length=64)
    name: str | None = Field(default=None, min_length=1, max_length=300)
    cve_id: str | None = Field(default=None, max_length=32)
    cnnvd_id: str | None = Field(default=None, max_length=32)
    severity: Severity | None = None
    cvss_score: float | None = Field(default=None, ge=0, le=10)
    vuln_type: str | None = Field(default=None, max_length=100)
    source: str | None = Field(default=None, max_length=100)
    description: str | None = Field(default=None, max_length=10_000)
    solution: str | None = Field(default=None, max_length=10_000)
    discovered_at: datetime | None = None
    due_at: datetime | None = None
    status: WorkflowStatus | None = None
    assignee_id: int | None = Field(default=None, gt=0)
    closed_at: datetime | None = None
    asset_ids: list[int] | None = Field(default=None, max_length=500)


class VulnerabilityRead(VulnerabilityBase):
    id: int
    created_at: datetime
    updated_at: datetime


class SecurityEventBase(APIModel):
    event_code: str = Field(min_length=1, max_length=64, examples=["EVENT-001"])
    title: str = Field(min_length=1, max_length=300)
    category: str = Field(min_length=1, max_length=100)
    severity: Severity
    source: str | None = Field(default=None, max_length=100)
    source_ip: str | None = Field(default=None, max_length=45)
    destination_ip: str | None = Field(default=None, max_length=45)
    description: str | None = Field(default=None, max_length=10_000)
    occurred_at: datetime
    detected_at: datetime
    status: WorkflowStatus = WorkflowStatus.NO_RESPONSE
    assignee_id: int | None = Field(default=None, gt=0)
    response_summary: str | None = Field(default=None, max_length=10_000)
    closed_at: datetime | None = None
    asset_ids: list[int] = Field(default_factory=list, max_length=500)


class SecurityEventCreate(SecurityEventBase):
    pass


class SecurityEventUpdate(APIModel):
    event_code: str | None = Field(default=None, min_length=1, max_length=64)
    title: str | None = Field(default=None, min_length=1, max_length=300)
    category: str | None = Field(default=None, min_length=1, max_length=100)
    severity: Severity | None = None
    source: str | None = Field(default=None, max_length=100)
    source_ip: str | None = Field(default=None, max_length=45)
    destination_ip: str | None = Field(default=None, max_length=45)
    description: str | None = Field(default=None, max_length=10_000)
    occurred_at: datetime | None = None
    detected_at: datetime | None = None
    status: WorkflowStatus | None = None
    assignee_id: int | None = Field(default=None, gt=0)
    response_summary: str | None = Field(default=None, max_length=10_000)
    closed_at: datetime | None = None
    asset_ids: list[int] | None = Field(default=None, max_length=500)


class SecurityEventRead(SecurityEventBase):
    id: int
    created_at: datetime
    updated_at: datetime


class AssetDetail(AssetRead):
    vulnerabilities: list[VulnerabilityRead]
    security_events: list[SecurityEventRead]


class OwnershipStatistics(APIModel):
    total_assets: int
    assets_with_owner: int
    assets_without_owner: int


class StatusCounts(APIModel):
    closed: int
    responding: int
    no_response: int


class AssetRiskItem(APIModel):
    asset_id: int
    asset_code: str
    asset_name: str
    vulnerability_count: int
    event_count: int
    total_count: int
    status: StatusCounts


class AssetRiskStatistics(APIModel):
    total_assets: int
    total_vulnerabilities: int
    total_events: int
    status: StatusCounts
    assets: list[AssetRiskItem]


class DistributionStatistics(APIModel):
    total: int
    severity: dict[str, int]
    status: StatusCounts
