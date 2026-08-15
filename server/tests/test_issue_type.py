import unittest

from models.github_ops_output import GitHubOpsResponse
from tools.github.issue_type import (
    branch_name_for_issue,
    classify_issue,
    fallback_github_ops,
    normalize_labels,
    sanitize_github_ops,
    slugify,
)
from tools.github.pull_requests import build_pr_body


class IssueTypeTests(unittest.TestCase):
    def test_labels_win_over_title(self) -> None:
        self.assertEqual(
            classify_issue(["enhancement", "priority:high"], "Crash on login", "app blows up"),
            "feat",
        )
        self.assertEqual(classify_issue(["type:bug"], "Add OAuth", ""), "fix")
        self.assertEqual(classify_issue(["documentation"], "Add OAuth", ""), "docs")

    def test_text_fallback_when_labels_missing(self) -> None:
        self.assertEqual(classify_issue([], "Login crash on empty password", ""), "fix")
        self.assertEqual(classify_issue(["good first issue"], "Add OAuth login", ""), "feat")
        self.assertEqual(classify_issue([], "Update README install steps", ""), "docs")

    def test_slugify_and_branch_name(self) -> None:
        self.assertEqual(slugify("Login crash on empty password"), "login-crash-on-empty-password")
        self.assertEqual(
            branch_name_for_issue(42, "Login crash on empty password", "fix"),
            "fix/42-login-crash-on-empty-password",
        )

    def test_normalize_labels_from_github_payload(self) -> None:
        self.assertEqual(
            normalize_labels([{"name": "bug"}, "enhancement", None]),
            ["bug", "enhancement"],
        )

    def test_sanitize_rebuilds_branch_from_type_and_title(self) -> None:
        cleaned = sanitize_github_ops(
            {
                "issue_type": "feat",
                "branch_name": "totally invalid name with spaces!!!",
                "commit_prefix": "feat",
                "pr_title": "Feat: Add OAuth login",
                "closes_keyword": "Closes",
                "rationale": "Label enhancement.",
            },
            issue_number=87,
            title="Add OAuth login",
        )
        self.assertEqual(cleaned["branch_name"], "feat/87-add-oauth-login")
        self.assertEqual(cleaned["commit_prefix"], "feat")
        self.assertEqual(cleaned["closes_keyword"], "Closes")
        self.assertEqual(cleaned["pr_title"], "Feat: Add OAuth login")

    def test_sanitize_empty_payload_uses_labels(self) -> None:
        cleaned = sanitize_github_ops(
            {},
            issue_number=4,
            title="Add OAuth login",
            labels=["enhancement"],
        )
        self.assertEqual(cleaned["issue_type"], "feat")
        self.assertEqual(cleaned["branch_name"], "feat/4-add-oauth-login")
        cleaned = sanitize_github_ops(
            {"issue_type": "mystery"},
            issue_number=1,
            title="Something odd",
        )
        self.assertEqual(cleaned["issue_type"], "fix")
        self.assertEqual(cleaned["branch_name"], "fix/1-something-odd")
        self.assertEqual(cleaned["closes_keyword"], "Fixes")

    def test_fallback_uses_labels(self) -> None:
        result = fallback_github_ops(
            issue_number=9,
            title="Bump lodash",
            labels=["dependencies"],
        )
        self.assertEqual(result["issue_type"], "chore")
        self.assertEqual(result["branch_name"], "chore/9-bump-lodash")
        self.assertEqual(result["closes_keyword"], "Closes")

    def test_github_ops_schema(self) -> None:
        parsed = GitHubOpsResponse(
            issue_type="fix",
            branch_name="fix/3-login-crash",
            commit_prefix="fix",
            pr_title="Fix: Login crash",
            closes_keyword="Fixes",
            rationale="Label bug.",
        )
        self.assertEqual(parsed.issue_type, "fix")

    def test_pr_body_closes_keyword(self) -> None:
        body = build_pr_body(12, "Add OAuth", ["a.py"], closes_keyword="Closes")
        self.assertIn("Closes #12", body)
        self.assertNotIn("Fixes #12", body)


if __name__ == "__main__":
    unittest.main()
