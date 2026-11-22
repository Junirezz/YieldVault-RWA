import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchPublicConfig } from "./publicConfig";
import { ValidationError } from "./api";

const { mockGet } = vi.hoisted(() => ({
  mockGet: vi.fn(),
}));

vi.mock("./apiClient", () => ({
  apiClient: {
    get: mockGet,
  },
}));

const validConfig = {
  environment: "production",
  features: { "deposit-v2": true, "analytics-page": false },
  maintenanceMode: { enabled: false },
};

describe("fetchPublicConfig", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("fetches and validates the public config payload", async () => {
    mockGet.mockResolvedValue(validConfig);

    const config = await fetchPublicConfig();

    expect(mockGet).toHaveBeenCalledWith("/config", { retry: false });
    expect(config).toEqual(validConfig);
  });

  it("throws ValidationError when the payload violates the schema", async () => {
    mockGet.mockResolvedValue({ environment: "staging", features: {} });

    await expect(fetchPublicConfig()).rejects.toBeInstanceOf(ValidationError);
  });

  it("rejects payloads that expose keys outside the allow-list", async () => {
    mockGet.mockResolvedValue({
      ...validConfig,
      databaseUrl: "postgres://user:pass@internal-host/db",
    });

    await expect(fetchPublicConfig()).rejects.toBeInstanceOf(ValidationError);
  });

  it("rejects an unknown feature-flag key", async () => {
    mockGet.mockResolvedValue({
      environment: "production",
      features: { "not-a-public-flag": true },
      maintenanceMode: { enabled: false },
    });

    await expect(fetchPublicConfig()).rejects.toBeInstanceOf(ValidationError);
  });
});
