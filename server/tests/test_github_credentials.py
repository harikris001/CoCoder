import unittest
from urllib.parse import quote

from secure_store import GitHubCredential, GitHubSecrets
from tools.github.git_ops import _authenticated_url, _clean_url, _redact_git_error


class GitHubCredentialTests(unittest.TestCase):
    def test_active_credential_falls_back_to_other_source(self) -> None:
        credentials = GitHubSecrets(
            active_source="oauth",
            pat=GitHubCredential(token="pat-token"),
        )

        active = credentials.active()

        self.assertIsNotNone(active)
        assert active is not None
        self.assertEqual(active[0], "pat")
        self.assertEqual(active[1].token, "pat-token")

    def test_authenticated_git_url_is_cleaned_before_storage(self) -> None:
        authenticated = _authenticated_url(
            "https://github.com/acme/private-service.git",
            "token/with-specials",
        )

        self.assertIn("x-access-token:token%2Fwith-specials@", authenticated)
        self.assertEqual(
            _clean_url(authenticated),
            "https://github.com/acme/private-service.git",
        )

    def test_git_errors_redact_raw_and_encoded_tokens(self) -> None:
        token = "token/with-specials"
        error = (
            f"clone https://x-access-token:{token}@github.com/acme/repo.git "
            f"and https://x-access-token:{quote(token, safe='')}@github.com/acme/repo.git"
        )

        redacted = _redact_git_error(error, token)

        self.assertNotIn(token, redacted)
        self.assertNotIn(quote(token, safe=""), redacted)
        self.assertEqual(redacted.count("[REDACTED]"), 2)


if __name__ == "__main__":
    unittest.main()
