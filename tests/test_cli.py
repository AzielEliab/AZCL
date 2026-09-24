import contextlib
import json
import unittest
from io import StringIO

from azcl.cli import help_text, main, status_payload, welcome_text


class StubCliTest(unittest.TestCase):
    def test_welcome_says_not_ready(self):
        text = welcome_text()
        self.assertIn("This package is not ready yet.", text)
        self.assertIn("Author: Aziel Eliab", text)
        self.assertIn("When it ships, the next step will be the first run:", text)
        self.assertIn("azcl --help", text)
        self.assertNotIn("what this is not", text.lower())

    def test_help_is_short(self):
        text = help_text()
        self.assertIn("Usage:", text)
        self.assertIn("--json", text)
        self.assertLess(text.count("\n"), 40)

    def test_bare_command(self):
        out = StringIO()
        with contextlib.redirect_stdout(out):
            code = main([])
        self.assertEqual(code, 0)
        self.assertIn("not ready yet", out.getvalue())

    def test_json_is_not_ready(self):
        out = StringIO()
        with contextlib.redirect_stdout(out):
            code = main(["--json"])
        self.assertEqual(code, 0)
        payload = json.loads(out.getvalue())
        self.assertEqual(payload, status_payload())
        self.assertIs(payload["ready"], False)
        self.assertEqual(payload["author"], "Aziel Eliab")
        self.assertNotIn("version", payload)

    def test_unknown_command(self):
        err = StringIO()
        with contextlib.redirect_stderr(err):
            code = main(["bogus"])
        self.assertEqual(code, 2)
        message = err.getvalue()
        self.assertIn('Unknown command "bogus".', message)
        self.assertIn("Try: azcl   or   azcl --help", message)
        self.assertNotIn("Traceback", message)

    def test_unknown_option(self):
        err = StringIO()
        with contextlib.redirect_stderr(err):
            code = main(["--version"])
        self.assertEqual(code, 2)
        self.assertIn('Unknown option "--version".', err.getvalue())


if __name__ == "__main__":
    unittest.main()
