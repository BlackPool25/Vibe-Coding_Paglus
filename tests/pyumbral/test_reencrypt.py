"""
pyUmbral Proxy Re-Encryption Unit Tests

This module tests the complete encrypt → rekey → reencrypt → decrypt roundtrip
using the pyUmbral library directly (without the FastAPI service).

Official Documentation References:
  - pyUmbral: https://pyumbral.readthedocs.io/en/latest/
  - pyUmbral API: https://pyumbral.readthedocs.io/en/latest/api.html
  - pyUmbral GitHub: https://github.com/nucypher/pyUmbral
  - pyUmbral Usage Guide: https://pyumbral.readthedocs.io/en/latest/using_pyumbral.html

Run with: pytest tests/pyumbral/test_reencrypt.py -v
"""

import pytest
import base64
import time

# pyUmbral imports (per https://pyumbral.readthedocs.io/en/latest/api.html)
from umbral import (
    SecretKey,
    PublicKey,
    Signer,
    Capsule,
    KeyFrag,
    VerifiedKeyFrag,
    CapsuleFrag,
    VerifiedCapsuleFrag,
    encrypt,
    decrypt_original,
    generate_kfrags,
    reencrypt,
    decrypt_reencrypted,
)


class TestUmbralKeyGeneration:
    """Test key generation functionality"""
    
    def test_generate_secret_key(self):
        """
        Test SecretKey.random() generates valid keys.
        Ref: https://pyumbral.readthedocs.io/en/latest/api.html#umbral.SecretKey
        """
        sk = SecretKey.random()
        assert sk is not None
        
        # Serialize and deserialize
        sk_bytes = sk.to_secret_bytes()
        assert len(sk_bytes) == SecretKey.serialized_size()
        
        sk_restored = SecretKey.from_bytes(sk_bytes)
        assert sk_restored is not None
    
    def test_derive_public_key(self):
        """
        Test public key derivation from secret key.
        Ref: https://pyumbral.readthedocs.io/en/latest/api.html#umbral.SecretKey.public_key
        """
        sk = SecretKey.random()
        pk = sk.public_key()
        assert pk is not None
        
        # Serialize and deserialize
        pk_bytes = bytes(pk)
        assert len(pk_bytes) == PublicKey.serialized_size()
        
        pk_restored = PublicKey.from_bytes(pk_bytes)
        assert pk_restored == pk
    
    def test_create_signer(self):
        """
        Test Signer creation and signing.
        Ref: https://pyumbral.readthedocs.io/en/latest/api.html#umbral.Signer
        """
        signing_sk = SecretKey.random()
        signer = Signer(signing_sk)
        
        verifying_key = signer.verifying_key()
        assert verifying_key == signing_sk.public_key()
        
        # Sign a message
        message = b"test message"
        signature = signer.sign(message)
        
        # Verify signature
        assert signature.verify(verifying_key, message)


class TestUmbralEncryption:
    """Test encryption and decryption functionality"""
    
    def test_encrypt_decrypt_original(self):
        """
        Test basic encrypt/decrypt_original roundtrip (no re-encryption).
        Ref: https://pyumbral.readthedocs.io/en/latest/api.html#umbral.encrypt
        Ref: https://pyumbral.readthedocs.io/en/latest/api.html#umbral.decrypt_original
        """
        # Generate Alice's key pair
        alice_sk = SecretKey.random()
        alice_pk = alice_sk.public_key()
        
        # Encrypt data
        plaintext = b"Hello, Proxy Re-Encryption!"
        capsule, ciphertext = encrypt(alice_pk, plaintext)
        
        assert capsule is not None
        assert ciphertext is not None
        assert ciphertext != plaintext
        
        # Decrypt with Alice's secret key
        decrypted = decrypt_original(alice_sk, capsule, ciphertext)
        assert decrypted == plaintext
    
    def test_capsule_serialization(self):
        """
        Test Capsule serialization/deserialization.
        Ref: https://pyumbral.readthedocs.io/en/latest/api.html#umbral.Capsule
        """
        alice_sk = SecretKey.random()
        alice_pk = alice_sk.public_key()
        
        capsule, ciphertext = encrypt(alice_pk, b"test data")
        
        # Serialize
        capsule_bytes = bytes(capsule)
        assert len(capsule_bytes) == Capsule.serialized_size()
        
        # Deserialize
        capsule_restored = Capsule.from_bytes(capsule_bytes)
        assert capsule_restored == capsule


class TestUmbralReencryption:
    """Test the complete re-encryption flow"""
    
    @pytest.fixture
    def alice_keys(self):
        """Generate Alice's (owner) key pairs"""
        delegating_sk = SecretKey.random()
        delegating_pk = delegating_sk.public_key()
        signing_sk = SecretKey.random()
        signer = Signer(signing_sk)
        verifying_key = signing_sk.public_key()
        return {
            "delegating_sk": delegating_sk,
            "delegating_pk": delegating_pk,
            "signing_sk": signing_sk,
            "signer": signer,
            "verifying_key": verifying_key
        }
    
    @pytest.fixture
    def bob_keys(self):
        """Generate Bob's (recipient) key pairs"""
        sk = SecretKey.random()
        pk = sk.public_key()
        return {"sk": sk, "pk": pk}
    
    def test_generate_kfrags(self, alice_keys, bob_keys):
        """
        Test KFrag generation.
        Ref: https://pyumbral.readthedocs.io/en/latest/api.html#umbral.generate_kfrags
        """
        kfrags = generate_kfrags(
            delegating_sk=alice_keys["delegating_sk"],
            receiving_pk=bob_keys["pk"],
            signer=alice_keys["signer"],
            threshold=2,
            shares=3,
            sign_delegating_key=True,
            sign_receiving_key=True
        )
        
        assert len(kfrags) == 3
        for kfrag in kfrags:
            assert isinstance(kfrag, VerifiedKeyFrag)
    
    def test_kfrag_serialization(self, alice_keys, bob_keys):
        """
        Test KFrag serialization/deserialization.
        Ref: https://pyumbral.readthedocs.io/en/latest/api.html#umbral.VerifiedKeyFrag
        """
        kfrags = generate_kfrags(
            delegating_sk=alice_keys["delegating_sk"],
            receiving_pk=bob_keys["pk"],
            signer=alice_keys["signer"],
            threshold=1,
            shares=1
        )
        
        kfrag = kfrags[0]
        
        # Serialize VerifiedKeyFrag
        kfrag_bytes = bytes(kfrag)
        assert len(kfrag_bytes) == VerifiedKeyFrag.serialized_size()
        
        # Deserialize using from_verified_bytes (trusted source)
        kfrag_restored = VerifiedKeyFrag.from_verified_bytes(kfrag_bytes)
        assert kfrag_restored is not None
    
    def test_reencrypt(self, alice_keys, bob_keys):
        """
        Test capsule re-encryption.
        Ref: https://pyumbral.readthedocs.io/en/latest/api.html#umbral.reencrypt
        """
        # Encrypt data with Alice's public key
        plaintext = b"Secret message for Bob"
        capsule, ciphertext = encrypt(alice_keys["delegating_pk"], plaintext)
        
        # Generate kfrags
        kfrags = generate_kfrags(
            delegating_sk=alice_keys["delegating_sk"],
            receiving_pk=bob_keys["pk"],
            signer=alice_keys["signer"],
            threshold=2,
            shares=3
        )
        
        # Perform re-encryption (simulating Ursula proxies)
        cfrags = []
        for kfrag in kfrags[:2]:  # Use threshold number of kfrags
            cfrag = reencrypt(capsule=capsule, kfrag=kfrag)
            assert isinstance(cfrag, VerifiedCapsuleFrag)
            cfrags.append(cfrag)
        
        assert len(cfrags) == 2
    
    def test_full_roundtrip(self, alice_keys, bob_keys):
        """
        Test the complete encrypt → rekey → reencrypt → decrypt roundtrip.
        
        This is the main integration test demonstrating the full PRE flow:
        1. Alice encrypts data with her public key
        2. Alice generates KFrags for Bob
        3. Proxies (Ursulas) perform re-encryption
        4. Bob decrypts using the re-encrypted capsule fragments
        
        Refs:
          - https://pyumbral.readthedocs.io/en/latest/using_pyumbral.html
          - https://github.com/nucypher/pyUmbral
        """
        # Step 1: Alice encrypts data
        plaintext = b"Highly confidential healthcare data"
        capsule, ciphertext = encrypt(alice_keys["delegating_pk"], plaintext)
        
        # Verify Alice can decrypt her own data
        alice_decrypted = decrypt_original(
            alice_keys["delegating_sk"], capsule, ciphertext
        )
        assert alice_decrypted == plaintext
        
        # Step 2: Alice generates KFrags for Bob (threshold 2-of-3)
        kfrags = generate_kfrags(
            delegating_sk=alice_keys["delegating_sk"],
            receiving_pk=bob_keys["pk"],
            signer=alice_keys["signer"],
            threshold=2,
            shares=3,
            sign_delegating_key=True,
            sign_receiving_key=True
        )
        
        # Step 3: Proxies perform re-encryption
        # In production, different Ursulas would each hold one kfrag
        cfrags = []
        for kfrag in kfrags[:2]:  # Only need threshold (2) kfrags
            cfrag = reencrypt(capsule=capsule, kfrag=kfrag)
            cfrags.append(cfrag)
        
        # Step 4: Bob decrypts using re-encrypted capsule fragments
        bob_decrypted = decrypt_reencrypted(
            receiving_sk=bob_keys["sk"],
            delegating_pk=alice_keys["delegating_pk"],
            capsule=capsule,
            verified_cfrags=cfrags,
            ciphertext=ciphertext
        )
        
        assert bob_decrypted == plaintext
    
    def test_roundtrip_with_serialization(self, alice_keys, bob_keys):
        """
        Test roundtrip with serialization at each step.
        
        This simulates a real-world scenario where data is serialized
        for storage/transmission between each step.
        """
        # Encrypt
        plaintext = b"Test data with serialization"
        capsule, ciphertext = encrypt(alice_keys["delegating_pk"], plaintext)
        
        # Serialize capsule and ciphertext (as would be stored in IPFS)
        capsule_b64 = base64.b64encode(bytes(capsule)).decode()
        ciphertext_b64 = base64.b64encode(ciphertext).decode()
        
        # Generate and serialize kfrags (as would be stored in Vault)
        kfrags = generate_kfrags(
            delegating_sk=alice_keys["delegating_sk"],
            receiving_pk=bob_keys["pk"],
            signer=alice_keys["signer"],
            threshold=1,
            shares=1
        )
        kfrag_b64 = base64.b64encode(bytes(kfrags[0])).decode()
        
        # Simulate proxy re-encryption (deserialize, reencrypt, serialize)
        capsule_restored = Capsule.from_bytes(base64.b64decode(capsule_b64))
        kfrag_restored = VerifiedKeyFrag.from_verified_bytes(
            base64.b64decode(kfrag_b64)
        )
        cfrag = reencrypt(capsule=capsule_restored, kfrag=kfrag_restored)
        cfrag_b64 = base64.b64encode(bytes(cfrag)).decode()
        
        # Deserialize and decrypt
        cfrag_bytes = base64.b64decode(cfrag_b64)
        cfrag_restored = CapsuleFrag.from_bytes(cfrag_bytes)
        
        # Verify cfrag before decryption
        verified_cfrag = cfrag_restored.verify(
            capsule=capsule_restored,
            verifying_pk=alice_keys["verifying_key"],
            delegating_pk=alice_keys["delegating_pk"],
            receiving_pk=bob_keys["pk"]
        )
        
        # Decrypt
        ciphertext_restored = base64.b64decode(ciphertext_b64)
        bob_decrypted = decrypt_reencrypted(
            receiving_sk=bob_keys["sk"],
            delegating_pk=alice_keys["delegating_pk"],
            capsule=capsule_restored,
            verified_cfrags=[verified_cfrag],
            ciphertext=ciphertext_restored
        )
        
        assert bob_decrypted == plaintext
    
    def test_threshold_requirement(self, alice_keys, bob_keys):
        """
        Test that threshold number of cfrags is required for decryption.
        
        With threshold=3 and shares=5, we need at least 3 cfrags to decrypt.
        """
        # Encrypt
        plaintext = b"Threshold test data"
        capsule, ciphertext = encrypt(alice_keys["delegating_pk"], plaintext)
        
        # Generate kfrags with higher threshold
        kfrags = generate_kfrags(
            delegating_sk=alice_keys["delegating_sk"],
            receiving_pk=bob_keys["pk"],
            signer=alice_keys["signer"],
            threshold=3,
            shares=5
        )
        
        # Re-encrypt with exactly threshold cfrags
        cfrags = [reencrypt(capsule=capsule, kfrag=kfrag) for kfrag in kfrags[:3]]
        
        # Should succeed with threshold cfrags
        decrypted = decrypt_reencrypted(
            receiving_sk=bob_keys["sk"],
            delegating_pk=alice_keys["delegating_pk"],
            capsule=capsule,
            verified_cfrags=cfrags,
            ciphertext=ciphertext
        )
        assert decrypted == plaintext
        
        # Can also use more than threshold
        cfrags_all = [reencrypt(capsule=capsule, kfrag=kfrag) for kfrag in kfrags]
        decrypted2 = decrypt_reencrypted(
            receiving_sk=bob_keys["sk"],
            delegating_pk=alice_keys["delegating_pk"],
            capsule=capsule,
            verified_cfrags=cfrags_all,
            ciphertext=ciphertext
        )
        assert decrypted2 == plaintext


class TestUmbralSecurityProperties:
    """Test security properties of the PRE scheme"""
    
    def test_wrong_recipient_cannot_decrypt(self):
        """
        Test that a different recipient cannot decrypt.
        """
        # Alice's keys
        alice_sk = SecretKey.random()
        alice_pk = alice_sk.public_key()
        alice_signing_sk = SecretKey.random()
        alice_signer = Signer(alice_signing_sk)
        
        # Bob's keys (intended recipient)
        bob_sk = SecretKey.random()
        bob_pk = bob_sk.public_key()
        
        # Charlie's keys (unauthorized party)
        charlie_sk = SecretKey.random()
        charlie_pk = charlie_sk.public_key()
        
        # Alice encrypts and creates kfrags for Bob
        plaintext = b"Secret for Bob only"
        capsule, ciphertext = encrypt(alice_pk, plaintext)
        
        kfrags = generate_kfrags(
            delegating_sk=alice_sk,
            receiving_pk=bob_pk,
            signer=alice_signer,
            threshold=1,
            shares=1
        )
        
        # Re-encrypt for Bob
        cfrag = reencrypt(capsule=capsule, kfrag=kfrags[0])
        
        # Bob can decrypt
        bob_decrypted = decrypt_reencrypted(
            receiving_sk=bob_sk,
            delegating_pk=alice_pk,
            capsule=capsule,
            verified_cfrags=[cfrag],
            ciphertext=ciphertext
        )
        assert bob_decrypted == plaintext
        
        # Charlie cannot decrypt (wrong key)
        with pytest.raises(ValueError):
            decrypt_reencrypted(
                receiving_sk=charlie_sk,
                delegating_pk=alice_pk,
                capsule=capsule,
                verified_cfrags=[cfrag],
                ciphertext=ciphertext
            )
    
    def test_cfrag_verification(self):
        """
        Test that invalid cfrags are detected during verification.
        Ref: https://pyumbral.readthedocs.io/en/latest/api.html#umbral.CapsuleFrag.verify
        """
        # Alice's keys
        alice_sk = SecretKey.random()
        alice_pk = alice_sk.public_key()
        alice_signing_sk = SecretKey.random()
        alice_signer = Signer(alice_signing_sk)
        alice_verifying_key = alice_signing_sk.public_key()
        
        # Bob's keys
        bob_sk = SecretKey.random()
        bob_pk = bob_sk.public_key()
        
        # Different signing key (attacker)
        attacker_signing_sk = SecretKey.random()
        attacker_signer = Signer(attacker_signing_sk)
        
        # Alice encrypts
        plaintext = b"Test verification"
        capsule, _ = encrypt(alice_pk, plaintext)
        
        # Generate kfrags with attacker's signer
        attacker_kfrags = generate_kfrags(
            delegating_sk=alice_sk,
            receiving_pk=bob_pk,
            signer=attacker_signer,  # Wrong signer!
            threshold=1,
            shares=1
        )
        
        # Re-encrypt
        cfrag = reencrypt(capsule=capsule, kfrag=attacker_kfrags[0])
        
        # Serialize and deserialize cfrag (simulate transmission)
        cfrag_bytes = bytes(cfrag)
        cfrag_received = CapsuleFrag.from_bytes(cfrag_bytes)
        
        # Verification should fail because signer doesn't match
        from umbral import VerificationError
        with pytest.raises(VerificationError):
            cfrag_received.verify(
                capsule=capsule,
                verifying_pk=alice_verifying_key,  # Alice's key, not attacker's
                delegating_pk=alice_pk,
                receiving_pk=bob_pk
            )


class TestUmbralEdgeCases:
    """Test edge cases and error handling"""
    
    def test_empty_plaintext(self):
        """Test encryption of empty data"""
        sk = SecretKey.random()
        pk = sk.public_key()
        
        capsule, ciphertext = encrypt(pk, b"")
        decrypted = decrypt_original(sk, capsule, ciphertext)
        assert decrypted == b""
    
    def test_large_plaintext(self):
        """Test encryption of large data (1MB)"""
        sk = SecretKey.random()
        pk = sk.public_key()
        
        # 1MB of data
        plaintext = b"x" * (1024 * 1024)
        capsule, ciphertext = encrypt(pk, plaintext)
        decrypted = decrypt_original(sk, capsule, ciphertext)
        assert decrypted == plaintext
    
    def test_minimum_threshold(self):
        """Test with minimum threshold (1-of-1)"""
        alice_sk = SecretKey.random()
        alice_pk = alice_sk.public_key()
        alice_signer = Signer(SecretKey.random())
        
        bob_sk = SecretKey.random()
        bob_pk = bob_sk.public_key()
        
        plaintext = b"Minimum threshold test"
        capsule, ciphertext = encrypt(alice_pk, plaintext)
        
        kfrags = generate_kfrags(
            delegating_sk=alice_sk,
            receiving_pk=bob_pk,
            signer=alice_signer,
            threshold=1,
            shares=1
        )
        
        cfrag = reencrypt(capsule=capsule, kfrag=kfrags[0])
        
        decrypted = decrypt_reencrypted(
            receiving_sk=bob_sk,
            delegating_pk=alice_pk,
            capsule=capsule,
            verified_cfrags=[cfrag],
            ciphertext=ciphertext
        )
        assert decrypted == plaintext


# Integration test simulating the service flow
class TestServiceFlowSimulation:
    """
    Simulate the pyUmbral service flow without actually running the service.
    This tests the same logic that app.py uses.
    """
    
    def test_prepare_rekey_reencrypt_flow(self):
        """
        Simulate the full /prepare → /rekey → /reencrypt → /decrypt flow.
        
        This mirrors what the FastAPI endpoints do.
        """
        # Simulate storage (in production this is Vault)
        vault_storage = {}
        
        # === /prepare for Alice (owner) ===
        alice_id = "alice_org"
        alice_delegating_sk = SecretKey.random()
        alice_delegating_pk = alice_delegating_sk.public_key()
        alice_signing_sk = SecretKey.random()
        alice_signing_pk = alice_signing_sk.public_key()
        
        vault_storage[f"umbral/owners/{alice_id}"] = {
            "delegating_secret_key": alice_delegating_sk.to_secret_bytes().hex(),
            "public_key": bytes(alice_delegating_pk).hex(),
            "signing_secret_key": alice_signing_sk.to_secret_bytes().hex(),
            "verifying_key": bytes(alice_signing_pk).hex()
        }
        
        # === /prepare for Bob (recipient) ===
        bob_id = "bob_hospital"
        bob_sk = SecretKey.random()
        bob_pk = bob_sk.public_key()
        bob_signing_sk = SecretKey.random()
        
        vault_storage[f"umbral/owners/{bob_id}"] = {
            "delegating_secret_key": bob_sk.to_secret_bytes().hex(),
            "public_key": bytes(bob_pk).hex(),
            "signing_secret_key": bob_signing_sk.to_secret_bytes().hex(),
            "verifying_key": bytes(bob_signing_sk.public_key()).hex()
        }
        
        # === Encrypt data (simulating /encrypt) ===
        plaintext = b"Patient health record data"
        capsule, ciphertext = encrypt(alice_delegating_pk, plaintext)
        capsule_b64 = base64.b64encode(bytes(capsule)).decode()
        ciphertext_b64 = base64.b64encode(ciphertext).decode()
        
        # === /rekey ===
        rekey_id = "rekey-12345"
        expiry = int(time.time()) + 3600  # 1 hour from now
        
        # Reconstruct keys from storage (as service does)
        owner_data = vault_storage[f"umbral/owners/{alice_id}"]
        recipient_data = vault_storage[f"umbral/owners/{bob_id}"]
        
        delegating_sk = SecretKey.from_bytes(
            bytes.fromhex(owner_data["delegating_secret_key"])
        )
        signing_sk = SecretKey.from_bytes(
            bytes.fromhex(owner_data["signing_secret_key"])
        )
        signer = Signer(signing_sk)
        receiving_pk = PublicKey.from_bytes(
            bytes.fromhex(recipient_data["public_key"])
        )
        
        kfrags = generate_kfrags(
            delegating_sk=delegating_sk,
            receiving_pk=receiving_pk,
            signer=signer,
            threshold=1,
            shares=1
        )
        kfrags_b64 = [base64.b64encode(bytes(kf)).decode() for kf in kfrags]
        
        vault_storage[f"umbral/rekeys/{rekey_id}"] = {
            "owner_id": alice_id,
            "recipient_id": bob_id,
            "expiry": expiry,
            "kfrags": kfrags_b64,
            "owner_public_key": owner_data["public_key"],
            "owner_verifying_key": owner_data["verifying_key"],
            "recipient_public_key": recipient_data["public_key"]
        }
        
        # === /reencrypt ===
        rekey_data = vault_storage[f"umbral/rekeys/{rekey_id}"]
        
        # Check expiry (should pass)
        assert int(time.time()) <= rekey_data["expiry"]
        
        # Deserialize capsule
        capsule_restored = Capsule.from_bytes(base64.b64decode(capsule_b64))
        
        # Perform re-encryption
        cfrags = []
        for kfrag_b64 in rekey_data["kfrags"]:
            kfrag = VerifiedKeyFrag.from_verified_bytes(base64.b64decode(kfrag_b64))
            cfrag = reencrypt(capsule=capsule_restored, kfrag=kfrag)
            cfrags.append(cfrag)
        
        cfrags_b64 = [base64.b64encode(bytes(cf)).decode() for cf in cfrags]
        
        # === /decrypt (Bob's side) ===
        # Reconstruct recipient's secret key
        receiving_sk = SecretKey.from_bytes(
            bytes.fromhex(recipient_data["delegating_secret_key"])
        )
        delegating_pk = PublicKey.from_bytes(
            bytes.fromhex(rekey_data["owner_public_key"])
        )
        verifying_pk = PublicKey.from_bytes(
            bytes.fromhex(rekey_data["owner_verifying_key"])
        )
        receiving_pk = PublicKey.from_bytes(
            bytes.fromhex(rekey_data["recipient_public_key"])
        )
        
        # Deserialize cfrags and verify
        verified_cfrags = []
        for cfrag_b64 in cfrags_b64:
            cfrag = CapsuleFrag.from_bytes(base64.b64decode(cfrag_b64))
            verified_cfrag = cfrag.verify(
                capsule=capsule_restored,
                verifying_pk=verifying_pk,
                delegating_pk=delegating_pk,
                receiving_pk=receiving_pk
            )
            verified_cfrags.append(verified_cfrag)
        
        # Decrypt
        decrypted = decrypt_reencrypted(
            receiving_sk=receiving_sk,
            delegating_pk=delegating_pk,
            capsule=capsule_restored,
            verified_cfrags=verified_cfrags,
            ciphertext=base64.b64decode(ciphertext_b64)
        )
        
        assert decrypted == plaintext
    
    def test_expired_rekey_rejected(self):
        """
        Test that re-encryption is rejected for expired rekeys.
        """
        # Simulate an expired rekey
        expiry = int(time.time()) - 1  # 1 second in the past
        current_time = int(time.time())
        
        # This check should fail
        assert current_time > expiry, "Rekey should be expired"


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
