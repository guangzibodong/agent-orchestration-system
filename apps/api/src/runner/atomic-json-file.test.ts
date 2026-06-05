import { describe, expect, it, vi } from "vitest";
import { writeJsonFileAtomically } from "./atomic-json-file.js";

describe("writeJsonFileAtomically", () => {
  it("uses unique temp files and retries transient rename failures", () => {
    const renameSync = vi
      .fn()
      .mockImplementationOnce(() => {
        const error = new Error("file is temporarily locked") as Error & {
          code: string;
        };
        error.code = "EPERM";
        throw error;
      })
      .mockImplementationOnce(() => undefined);
    const writeFileSync = vi.fn();
    const mkdirSync = vi.fn();
    const unlinkSync = vi.fn();

    writeJsonFileAtomically("C:/state/workflows.json", [{ id: "run-1" }], {
      mkdirSync,
      writeFileSync,
      renameSync,
      unlinkSync,
      randomSuffix: () => "fixed",
      sleepSync: vi.fn(),
      maxRenameAttempts: 2
    });

    const tempPath = String(writeFileSync.mock.calls[0]?.[0]);

    expect(tempPath).toContain("workflows.json.");
    expect(tempPath).toContain(".fixed.tmp");
    expect(tempPath).not.toBe("C:/state/workflows.json.tmp");
    expect(renameSync).toHaveBeenCalledTimes(2);
    expect(renameSync).toHaveBeenCalledWith(
      tempPath,
      "C:/state/workflows.json"
    );
    expect(unlinkSync).not.toHaveBeenCalled();
  });

  it("removes the temp file when all rename attempts fail", () => {
    const error = new Error("still locked") as Error & { code: string };
    error.code = "EPERM";
    const renameSync = vi.fn(() => {
      throw error;
    });
    const writeFileSync = vi.fn();
    const unlinkSync = vi.fn();

    expect(() =>
      writeJsonFileAtomically("C:/state/jobs.json", [{ id: "job-1" }], {
        mkdirSync: vi.fn(),
        writeFileSync,
        renameSync,
        unlinkSync,
        randomSuffix: () => "locked",
        sleepSync: vi.fn(),
        maxRenameAttempts: 2
      })
    ).toThrow("still locked");

    expect(unlinkSync).toHaveBeenCalledWith(
      String(writeFileSync.mock.calls[0]?.[0])
    );
  });
});
