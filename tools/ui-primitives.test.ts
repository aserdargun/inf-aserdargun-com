import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { Button } from "../components/ui/button";

describe("shared UI primitives", () => {
  test("pending owns aria-busy when native button props provide false", () => {
    const markup = renderToStaticMarkup(createElement(Button, { "aria-busy": false, children: "Save to Inbox", pending: true }));

    expect(markup).toContain('aria-busy="true"');
  });
});
