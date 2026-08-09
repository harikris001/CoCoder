import unittest

from fastapi import HTTPException

from api.auth import hash_password, token_hash, validate_email, verify_password


class AuthHelperTests(unittest.TestCase):
    def test_password_hash_round_trip(self) -> None:
        password = "correct-horse-battery"
        password_hash = hash_password(password)

        self.assertNotEqual(password, password_hash)
        self.assertTrue(verify_password(password, password_hash))
        self.assertFalse(verify_password("wrong-password", password_hash))

    def test_email_is_normalized(self) -> None:
        self.assertEqual(validate_email("  USER@Example.COM "), "user@example.com")

    def test_invalid_email_is_rejected(self) -> None:
        with self.assertRaises(HTTPException):
            validate_email("not-an-email")

    def test_session_tokens_are_hashed_deterministically(self) -> None:
        self.assertEqual(token_hash("session-token"), token_hash("session-token"))
        self.assertNotEqual(token_hash("session-token"), token_hash("other-token"))


if __name__ == "__main__":
    unittest.main()
