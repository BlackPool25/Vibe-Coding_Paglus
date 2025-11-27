"""
pyUmbral Proxy Re-Encryption Microservice (FastAPI)

This service provides proxy re-encryption capabilities using the pyUmbral library.
It enables:
  - Key generation for organizations (public key stored on-chain, private in Vault)
  - Re-encryption key (KFrag) generation for delegated access
  - Capsule re-encryption (proxy transform)

Official Documentation References:
  - pyUmbral: https://pyumbral.readthedocs.io/en/latest/
  - pyUmbral API: https://pyumbral.readthedocs.io/en/latest/api.html
  - pyUmbral GitHub: https://github.com/nucypher/pyUmbral
  - Vault Developer QS: https://developer.hashicorp.com/vault/docs/get-started/developer-qs

SECURITY NOTES:
  - Private keys are NEVER logged or returned in API responses
  - Private keys are stored ONLY in HashiCorp Vault
  - ReKeys have expiry times and are stored in transient Vault paths
"""

import os
import uuid
import time
import base64
import logging
from datetime import datetime, timezone
from typing import Optional

from fastapi import FastAPI, HTTPException, status
from pydantic import BaseModel, Field
import hvac

# pyUmbral imports (per https://pyumbral.readthedocs.io/en/latest/api.html)
from umbral import (
    SecretKey,
    Signer,
    Capsule,
    KeyFrag,
    VerifiedKeyFrag,
    CapsuleFrag,
    encrypt,
    decrypt_original,
    generate_kfrags,
    reencrypt,
    decrypt_reencrypted,
)

# Configure logging - NEVER log private keys or plaintext
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)

# Vault configuration (from environment or defaults for dev)
VAULT_ADDR = os.getenv("VAULT_ADDR", "http://127.0.0.1:8200")
VAULT_TOKEN = os.getenv("VAULT_TOKEN", "dev-root-token")
VAULT_KV_MOUNT = os.getenv("VAULT_KV_MOUNT", "secret")

# Backend API URL for chaincode calls (grantAccess)
BACKEND_API_URL = os.getenv("BACKEND_API_URL", "http://127.0.0.1:3001")

app = FastAPI(
    title="pyUmbral Proxy Re-Encryption Service",
    description="Microservice for Umbral proxy re-encryption operations",
    version="1.0.0",
)


def get_vault_client() -> hvac.Client:
    """
    Initialize and return a Vault client.
    Ref: https://developer.hashicorp.com/vault/docs/get-started/developer-qs
    """
    client = hvac.Client(url=VAULT_ADDR, token=VAULT_TOKEN)
    if not client.is_authenticated():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Failed to authenticate with Vault"
        )
    return client


# ============================================================================
# Pydantic Models
# ============================================================================

class PrepareRequest(BaseModel):
    """Request model for /prepare endpoint - registers owner public key"""
    owner_id: str = Field(..., description="Unique identifier for the owner/org")


class PrepareResponse(BaseModel):
    """Response model for /prepare endpoint"""
    owner_id: str
    public_key: str = Field(..., description="Hex-encoded Umbral public key")
    verifying_key: str = Field(..., description="Hex-encoded verifying (signing) public key")
    message: str


class RekeyRequest(BaseModel):
    """Request model for /rekey endpoint"""
    owner_id: str = Field(..., description="Owner's unique identifier")
    recipient_id: str = Field(..., description="Recipient's unique identifier")
    resource_id: str = Field(..., description="Resource ID to grant access to")
    expiry: int = Field(..., description="Unix timestamp when rekey expires")
    threshold: int = Field(default=1, ge=1, description="Threshold for kfrags (M of N)")
    shares: int = Field(default=1, ge=1, description="Total number of kfrags (N)")


class RekeyResponse(BaseModel):
    """Response model for /rekey endpoint"""
    rekey_id: str = Field(..., description="Unique ID for this rekey operation")
    owner_id: str
    recipient_id: str
    resource_id: str
    expiry: int
    threshold: int
    shares: int
    message: str


class ReencryptRequest(BaseModel):
    """Request model for /reencrypt endpoint"""
    rekey_id: str = Field(..., description="ReKey ID from /rekey response")
    capsule: str = Field(..., description="Base64-encoded Umbral Capsule")
    ciphertext: str = Field(..., description="Base64-encoded ciphertext")


class ReencryptResponse(BaseModel):
    """Response model for /reencrypt endpoint"""
    rekey_id: str
    cfrags: list[str] = Field(..., description="Base64-encoded CapsuleFragments")
    capsule: str = Field(..., description="Original capsule (base64)")
    ciphertext: str = Field(..., description="Original ciphertext (base64)")
    message: str


class HealthResponse(BaseModel):
    """Health check response"""
    status: str
    vault_connected: bool
    timestamp: str


# ============================================================================
# Utility Functions
# ============================================================================

def store_secret_in_vault(client: hvac.Client, path: str, data: dict) -> None:
    """
    Store a secret in Vault KV v2 engine.
    Ref: https://developer.hashicorp.com/vault/docs/get-started/developer-qs#step-4-store-a-secret
    """
    client.secrets.kv.v2.create_or_update_secret(
        mount_point=VAULT_KV_MOUNT,
        path=path,
        secret=data
    )
    logger.info(f"Stored secret at path: {path} (contents not logged)")


def read_secret_from_vault(client: hvac.Client, path: str) -> Optional[dict]:
    """
    Read a secret from Vault KV v2 engine.
    Ref: https://developer.hashicorp.com/vault/docs/get-started/developer-qs#step-5-retrieve-a-secret
    """
    try:
        response = client.secrets.kv.v2.read_secret_version(
            mount_point=VAULT_KV_MOUNT,
            path=path
        )
        return response["data"]["data"]
    except hvac.exceptions.InvalidPath:
        return None


def delete_secret_from_vault(client: hvac.Client, path: str) -> None:
    """Delete a secret from Vault"""
    try:
        client.secrets.kv.v2.delete_metadata_and_all_versions(
            mount_point=VAULT_KV_MOUNT,
            path=path
        )
    except Exception as e:
        logger.warning(f"Failed to delete secret at {path}: {e}")


# ============================================================================
# API Endpoints
# ============================================================================

@app.get("/health", response_model=HealthResponse)
async def health_check():
    """Health check endpoint"""
    vault_ok = False
    try:
        client = get_vault_client()
        vault_ok = client.is_authenticated()
    except Exception:
        pass
    
    return HealthResponse(
        status="healthy" if vault_ok else "degraded",
        vault_connected=vault_ok,
        timestamp=datetime.now(timezone.utc).isoformat()
    )


@app.post("/prepare", response_model=PrepareResponse)
async def prepare_owner(request: PrepareRequest):
    """
    POST /prepare - Register owner public key
    
    Creates Umbral key pairs for an organization:
    - Delegating key pair (for encryption/delegation)
    - Signing key pair (for kfrag signatures)
    
    Public keys are returned and can be stored on-chain.
    Private keys are stored ONLY in Vault.
    
    pyUmbral ref: https://pyumbral.readthedocs.io/en/latest/using_pyumbral.html#generate-an-umbral-key-pair
    """
    vault = get_vault_client()
    owner_id = request.owner_id
    
    # Check if owner already exists
    existing = read_secret_from_vault(vault, f"umbral/owners/{owner_id}")
    if existing:
        # Return existing public keys
        return PrepareResponse(
            owner_id=owner_id,
            public_key=existing["public_key"],
            verifying_key=existing["verifying_key"],
            message="Owner already registered, returning existing public keys"
        )
    
    # Generate new Umbral key pairs
    # Ref: https://pyumbral.readthedocs.io/en/latest/api.html#umbral.SecretKey
    delegating_sk = SecretKey.random()
    delegating_pk = delegating_sk.public_key()
    
    signing_sk = SecretKey.random()
    signing_pk = signing_sk.public_key()
    
    # Serialize keys
    # Private keys use to_secret_bytes(), public keys use bytes()
    delegating_sk_hex = delegating_sk.to_secret_bytes().hex()
    delegating_pk_hex = bytes(delegating_pk).hex()
    signing_sk_hex = signing_sk.to_secret_bytes().hex()
    signing_pk_hex = bytes(signing_pk).hex()
    
    # Store in Vault (private keys NEVER logged)
    store_secret_in_vault(vault, f"umbral/owners/{owner_id}", {
        "delegating_secret_key": delegating_sk_hex,
        "public_key": delegating_pk_hex,
        "signing_secret_key": signing_sk_hex,
        "verifying_key": signing_pk_hex,
        "created_at": datetime.now(timezone.utc).isoformat()
    })
    
    logger.info(f"Registered new owner: {owner_id}")
    
    return PrepareResponse(
        owner_id=owner_id,
        public_key=delegating_pk_hex,
        verifying_key=signing_pk_hex,
        message="Owner registered successfully. Public keys can be stored on-chain."
    )


@app.post("/rekey", response_model=RekeyResponse)
async def generate_rekey(request: RekeyRequest):
    """
    POST /rekey - Generate re-encryption key fragments
    
    Creates KFrags that allow proxy re-encryption from owner to recipient.
    The KFrags are stored in Vault under a transient path with expiry metadata.
    Records grantAccess on-chain via backend API.
    
    pyUmbral ref: https://pyumbral.readthedocs.io/en/latest/api.html#umbral.generate_kfrags
    """
    vault = get_vault_client()
    
    # Validate expiry is in the future
    current_time = int(time.time())
    if request.expiry <= current_time:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Expiry must be in the future"
        )
    
    # Validate threshold <= shares
    if request.threshold > request.shares:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Threshold cannot exceed shares"
        )
    
    # Get owner's keys from Vault
    owner_data = read_secret_from_vault(vault, f"umbral/owners/{request.owner_id}")
    if not owner_data:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Owner {request.owner_id} not found. Call /prepare first."
        )
    
    # Get recipient's public key from Vault
    recipient_data = read_secret_from_vault(vault, f"umbral/owners/{request.recipient_id}")
    if not recipient_data:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Recipient {request.recipient_id} not found. They must call /prepare first."
        )
    
    # Reconstruct keys from hex
    # Ref: https://pyumbral.readthedocs.io/en/latest/api.html#umbral.SecretKey
    delegating_sk = SecretKey.from_bytes(bytes.fromhex(owner_data["delegating_secret_key"]))
    signing_sk = SecretKey.from_bytes(bytes.fromhex(owner_data["signing_secret_key"]))
    signer = Signer(signing_sk)
    
    from umbral import PublicKey
    receiving_pk = PublicKey.from_bytes(bytes.fromhex(recipient_data["public_key"]))
    
    # Generate KFrags
    # Ref: https://pyumbral.readthedocs.io/en/latest/api.html#umbral.generate_kfrags
    kfrags = generate_kfrags(
        delegating_sk=delegating_sk,
        receiving_pk=receiving_pk,
        signer=signer,
        threshold=request.threshold,
        shares=request.shares,
        sign_delegating_key=True,
        sign_receiving_key=True
    )
    
    # Generate unique rekey ID
    rekey_id = str(uuid.uuid4())
    
    # Serialize KFrags (VerifiedKeyFrag -> bytes -> base64)
    kfrags_b64 = [base64.b64encode(bytes(kfrag)).decode() for kfrag in kfrags]
    
    # Store in Vault under transient path
    store_secret_in_vault(vault, f"umbral/rekeys/{rekey_id}", {
        "owner_id": request.owner_id,
        "recipient_id": request.recipient_id,
        "resource_id": request.resource_id,
        "expiry": request.expiry,
        "threshold": request.threshold,
        "shares": request.shares,
        "kfrags": kfrags_b64,
        "owner_public_key": owner_data["public_key"],
        "owner_verifying_key": owner_data["verifying_key"],
        "recipient_public_key": recipient_data["public_key"],
        "created_at": datetime.now(timezone.utc).isoformat()
    })
    
    logger.info(f"Generated rekey {rekey_id}: owner={request.owner_id} -> recipient={request.recipient_id}, resource={request.resource_id}, expiry={request.expiry}")
    
    # TODO: Call backend API to record grantAccess on-chain
    # This would call the Fabric chaincode to record the access grant
    # Example: POST {BACKEND_API_URL}/share with resourceId, recipient, expiry
    # For now, we just log the intent
    logger.info(f"Would record on-chain: grantAccess(resourceId={request.resource_id}, recipient={request.recipient_id}, expiry={request.expiry})")
    
    return RekeyResponse(
        rekey_id=rekey_id,
        owner_id=request.owner_id,
        recipient_id=request.recipient_id,
        resource_id=request.resource_id,
        expiry=request.expiry,
        threshold=request.threshold,
        shares=request.shares,
        message=f"ReKey generated successfully. Valid until {datetime.fromtimestamp(request.expiry, timezone.utc).isoformat()}"
    )


@app.post("/reencrypt", response_model=ReencryptResponse)
async def perform_reencrypt(request: ReencryptRequest):
    """
    POST /reencrypt - Perform proxy re-encryption
    
    Uses stored KFrags to transform a capsule for the recipient.
    Refuses to operate if the rekey has expired.
    
    pyUmbral ref: https://pyumbral.readthedocs.io/en/latest/api.html#umbral.reencrypt
    """
    vault = get_vault_client()
    
    # Get rekey data from Vault
    rekey_data = read_secret_from_vault(vault, f"umbral/rekeys/{request.rekey_id}")
    if not rekey_data:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"ReKey {request.rekey_id} not found"
        )
    
    # Check expiry
    current_time = int(time.time())
    if current_time > rekey_data["expiry"]:
        # Clean up expired rekey
        delete_secret_from_vault(vault, f"umbral/rekeys/{request.rekey_id}")
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"ReKey {request.rekey_id} has expired"
        )
    
    # Deserialize capsule
    try:
        capsule_bytes = base64.b64decode(request.capsule)
        capsule = Capsule.from_bytes(capsule_bytes)
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid capsule format: {e}"
        )
    
    # Deserialize KFrags and perform re-encryption
    # Ref: https://pyumbral.readthedocs.io/en/latest/api.html#umbral.VerifiedKeyFrag
    cfrags = []
    for kfrag_b64 in rekey_data["kfrags"]:
        kfrag_bytes = base64.b64decode(kfrag_b64)
        # Use from_verified_bytes since these were stored after verification
        verified_kfrag = VerifiedKeyFrag.from_verified_bytes(kfrag_bytes)
        
        # Perform re-encryption
        # Ref: https://pyumbral.readthedocs.io/en/latest/api.html#umbral.reencrypt
        cfrag = reencrypt(capsule=capsule, kfrag=verified_kfrag)
        cfrags.append(cfrag)
    
    # Serialize CFrags
    cfrags_b64 = [base64.b64encode(bytes(cfrag)).decode() for cfrag in cfrags]
    
    logger.info(f"Re-encryption performed for rekey {request.rekey_id}: generated {len(cfrags)} cfrags")
    
    return ReencryptResponse(
        rekey_id=request.rekey_id,
        cfrags=cfrags_b64,
        capsule=request.capsule,
        ciphertext=request.ciphertext,
        message=f"Re-encryption successful. {len(cfrags)} capsule fragments generated."
    )


# ============================================================================
# Additional utility endpoints for testing
# ============================================================================

class EncryptRequest(BaseModel):
    """Request model for /encrypt test endpoint"""
    owner_id: str
    plaintext: str = Field(..., description="Base64-encoded plaintext to encrypt")


class EncryptResponse(BaseModel):
    """Response model for /encrypt test endpoint"""
    capsule: str
    ciphertext: str
    message: str


@app.post("/encrypt", response_model=EncryptResponse)
async def encrypt_data(request: EncryptRequest):
    """
    POST /encrypt - Encrypt data with owner's public key (utility endpoint)
    
    This is a utility endpoint for testing. In production, encryption
    would typically happen client-side.
    
    pyUmbral ref: https://pyumbral.readthedocs.io/en/latest/api.html#umbral.encrypt
    """
    vault = get_vault_client()
    
    # Get owner's public key
    owner_data = read_secret_from_vault(vault, f"umbral/owners/{request.owner_id}")
    if not owner_data:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Owner {request.owner_id} not found"
        )
    
    from umbral import PublicKey
    delegating_pk = PublicKey.from_bytes(bytes.fromhex(owner_data["public_key"]))
    
    # Decrypt base64 plaintext
    try:
        plaintext = base64.b64decode(request.plaintext)
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid base64 plaintext"
        )
    
    # Encrypt
    # Ref: https://pyumbral.readthedocs.io/en/latest/api.html#umbral.encrypt
    capsule, ciphertext = encrypt(delegating_pk, plaintext)
    
    return EncryptResponse(
        capsule=base64.b64encode(bytes(capsule)).decode(),
        ciphertext=base64.b64encode(ciphertext).decode(),
        message="Data encrypted successfully"
    )


class DecryptRequest(BaseModel):
    """Request model for /decrypt test endpoint"""
    recipient_id: str
    owner_id: str
    capsule: str
    ciphertext: str
    cfrags: list[str] = Field(..., description="Base64-encoded CapsuleFragments from /reencrypt")


class DecryptResponse(BaseModel):
    """Response model for /decrypt test endpoint"""
    plaintext: str
    message: str


@app.post("/decrypt", response_model=DecryptResponse)
async def decrypt_reencrypted_data(request: DecryptRequest):
    """
    POST /decrypt - Decrypt re-encrypted data (utility endpoint)
    
    This is a utility endpoint for testing. In production, decryption
    would typically happen client-side with the recipient's private key.
    
    pyUmbral ref: https://pyumbral.readthedocs.io/en/latest/api.html#umbral.decrypt_reencrypted
    """
    vault = get_vault_client()
    
    # Get recipient's private key
    recipient_data = read_secret_from_vault(vault, f"umbral/owners/{request.recipient_id}")
    if not recipient_data:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Recipient {request.recipient_id} not found"
        )
    
    # Get owner's public keys for verification
    owner_data = read_secret_from_vault(vault, f"umbral/owners/{request.owner_id}")
    if not owner_data:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Owner {request.owner_id} not found"
        )
    
    # Reconstruct keys
    receiving_sk = SecretKey.from_bytes(bytes.fromhex(recipient_data["delegating_secret_key"]))
    
    from umbral import PublicKey
    delegating_pk = PublicKey.from_bytes(bytes.fromhex(owner_data["public_key"]))
    verifying_pk = PublicKey.from_bytes(bytes.fromhex(owner_data["verifying_key"]))
    receiving_pk = PublicKey.from_bytes(bytes.fromhex(recipient_data["public_key"]))
    
    # Deserialize capsule and ciphertext
    try:
        capsule = Capsule.from_bytes(base64.b64decode(request.capsule))
        ciphertext = base64.b64decode(request.ciphertext)
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid capsule or ciphertext: {e}"
        )
    
    # Deserialize and verify CFrags
    # Ref: https://pyumbral.readthedocs.io/en/latest/api.html#umbral.CapsuleFrag
    verified_cfrags = []
    for cfrag_b64 in request.cfrags:
        cfrag_bytes = base64.b64decode(cfrag_b64)
        cfrag = CapsuleFrag.from_bytes(cfrag_bytes)
        
        # Verify the cfrag
        verified_cfrag = cfrag.verify(
            capsule=capsule,
            verifying_pk=verifying_pk,
            delegating_pk=delegating_pk,
            receiving_pk=receiving_pk
        )
        verified_cfrags.append(verified_cfrag)
    
    # Decrypt
    # Ref: https://pyumbral.readthedocs.io/en/latest/api.html#umbral.decrypt_reencrypted
    plaintext = decrypt_reencrypted(
        receiving_sk=receiving_sk,
        delegating_pk=delegating_pk,
        capsule=capsule,
        verified_cfrags=verified_cfrags,
        ciphertext=ciphertext
    )
    
    return DecryptResponse(
        plaintext=base64.b64encode(plaintext).decode(),
        message="Decryption successful"
    )


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
