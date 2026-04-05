import os
import base64
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from app.config import settings

class EncryptionService:
    """
    Servicio de cifrado simétrico (AES-GCM) para datos sensibles.
    Utiliza el SECRET_KEY de la configuración como base para el cifrado.
    """
    def __init__(self):
        # Derivamos una clave de 32 bytes del secret_key (lo truncamos o rellenamos si es necesario)
        # En una versión más robusta usaríamos PBKDF2, pero para este caso usaremos un hash simple o truncamiento
        import hashlib
        key_hash = hashlib.sha256(settings.secret_key.encode()).digest()
        self.aesgcm = AESGCM(key_hash)

    def encrypt(self, plaintext: str) -> str:
        """Cifra un texto y devuelve una cadena base64."""
        if not plaintext:
            return ""
        nonce = os.urandom(12)
        ciphertext = self.aesgcm.encrypt(nonce, plaintext.encode(), None)
        # Combinamos nonce + ciphertext y lo pasamos a base64
        return base64.b64encode(nonce + ciphertext).decode('utf-8')

    def decrypt(self, encrypted_data: str) -> str:
        """Descifra una cadena base64 y devuelve el texto original."""
        if not encrypted_data:
            return ""
        try:
            data = base64.b64encode(encrypted_data.encode()).decode('utf-8') # wait, no
            # Correct base64 decode
            raw_data = base64.b64decode(encrypted_data)
            nonce = raw_data[:12]
            ciphertext = raw_data[12:]
            decrypted = self.aesgcm.decrypt(nonce, ciphertext, None)
            return decrypted.decode('utf-8')
        except Exception as e:
            # Si falla el descifrado (ej: datos corruptos o no cifrados), devolvemos el original o error
            # Para migración, a veces es útil devolver el original si no empieza por formato b64 esperado
            return f"[ERROR_DEC] {encrypted_data}"

encryption_service = EncryptionService()
