import { beforeEach, describe, expect, it } from "vitest";
import {
  applyDocumentDirection,
  getLocale,
  getTextDirection,
  isRtlLocale,
  setLocale,
  t,
} from "./index";

describe("i18n", () => {
  beforeEach(() => {
    setLocale("en");
    applyDocumentDirection("en");
  });

  it("loads English and Spanish catalogs", () => {
    setLocale("en");
    expect(t("nav.vaults")).toBe("Vaults");
    setLocale("es");
    expect(t("nav.vaults")).toBe("Bóvedas");
    expect(getLocale()).toBe("es");
  });

  it("falls back to the key when a message is missing", () => {
    expect(t("definitely.missing.key")).toBe("definitely.missing.key");
  });

  it("interpolates named values", () => {
    setLocale("en");
    expect(t("session.warning.message", { minutes: 4 })).toContain("4");
  });

  it("marks future RTL languages without changing English/Spanish", () => {
    expect(isRtlLocale("en")).toBe(false);
    expect(isRtlLocale("es")).toBe(false);
    expect(isRtlLocale("ar")).toBe(true);
    expect(getTextDirection("he-IL")).toBe("rtl");
  });

  it("applies dir and lang on the document element", () => {
    applyDocumentDirection("ar");
    expect(document.documentElement.getAttribute("dir")).toBe("rtl");
    expect(document.documentElement.getAttribute("lang")).toBe("ar");

    applyDocumentDirection("en");
    expect(document.documentElement.getAttribute("dir")).toBe("ltr");
    expect(document.documentElement.getAttribute("lang")).toBe("en");
  });
});
