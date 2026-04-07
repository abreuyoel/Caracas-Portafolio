from passlib.context import CryptContext

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
hash_db = "$2b$12$JgMikspfQH1ZxY1bo2DZ4eC6cujLebQBf8MwyG.S3XQtozFnWGY1K"
password_test = "Financiera20*"

print(f"¿Coincide? {pwd_context.verify(password_test, hash_db)}")