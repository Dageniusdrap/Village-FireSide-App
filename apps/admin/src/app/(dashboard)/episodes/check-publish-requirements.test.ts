import { describe, expect, it } from "vitest";

import { checkPublishRequirements } from "./check-publish-requirements";

const baseEpisode = {
  audioUrl: "https://example.com/audio.mp3",
  title: "The Lake's First Story",
  description: "A story about the lake.",
  contentSource: "narrated_production",
};

describe("checkPublishRequirements", () => {
  it("passes all checks for a fully valid narrated-production episode", () => {
    const checks = checkPublishRequirements(baseEpisode, []);
    expect(checks.every((check) => check.passed)).toBe(true);
  });

  it("fails the audio check when audioUrl is null", () => {
    const checks = checkPublishRequirements({ ...baseEpisode, audioUrl: null }, []);
    const audioCheck = checks.find((check) => check.label === "Audio file uploaded");
    expect(audioCheck?.passed).toBe(false);
    expect(audioCheck?.reason).toMatch(/no audio file/i);
  });

  it("fails the title/description check when title is empty", () => {
    const checks = checkPublishRequirements({ ...baseEpisode, title: "" }, []);
    const check = checks.find((check) => check.label === "Title and description present");
    expect(check?.passed).toBe(false);
  });

  it("fails the title/description check when description is null", () => {
    const checks = checkPublishRequirements({ ...baseEpisode, description: null }, []);
    const check = checks.find((check) => check.label === "Title and description present");
    expect(check?.passed).toBe(false);
  });

  it("does not add an elder-consent check for non-elder-testimony episodes", () => {
    const checks = checkPublishRequirements(baseEpisode, []);
    expect(checks.find((check) => check.label === "Elder testimony consent")).toBeUndefined();
  });

  it("fails the elder-consent check when no contributor is linked", () => {
    const checks = checkPublishRequirements(
      { ...baseEpisode, contentSource: "elder_testimony" },
      [],
    );
    const check = checks.find((check) => check.label === "Elder testimony consent");
    expect(check?.passed).toBe(false);
  });

  it("fails the elder-consent check when a linked contributor is not an elder", () => {
    const checks = checkPublishRequirements({ ...baseEpisode, contentSource: "elder_testimony" }, [
      { contributorType: "translator", consentStatuses: ["granted"] },
    ]);
    const check = checks.find((check) => check.label === "Elder testimony consent");
    expect(check?.passed).toBe(false);
  });

  it("fails the elder-consent check when the elder's consent is granted_with_conditions, not granted", () => {
    const checks = checkPublishRequirements({ ...baseEpisode, contentSource: "elder_testimony" }, [
      { contributorType: "elder", consentStatuses: ["granted_with_conditions"] },
    ]);
    const check = checks.find((check) => check.label === "Elder testimony consent");
    expect(check?.passed).toBe(false);
  });

  it("fails the elder-consent check when the elder has a declined consent and no granted one", () => {
    const checks = checkPublishRequirements({ ...baseEpisode, contentSource: "elder_testimony" }, [
      { contributorType: "elder", consentStatuses: ["declined"] },
    ]);
    const check = checks.find((check) => check.label === "Elder testimony consent");
    expect(check?.passed).toBe(false);
  });

  it("passes the elder-consent check when a linked elder has a granted story_recording consent", () => {
    const checks = checkPublishRequirements({ ...baseEpisode, contentSource: "elder_testimony" }, [
      { contributorType: "elder", consentStatuses: ["granted"] },
    ]);
    const check = checks.find((check) => check.label === "Elder testimony consent");
    expect(check?.passed).toBe(true);
  });

  it("passes the elder-consent check when one of several linked contributors is a consented elder", () => {
    const checks = checkPublishRequirements({ ...baseEpisode, contentSource: "elder_testimony" }, [
      { contributorType: "translator", consentStatuses: ["granted"] },
      { contributorType: "elder", consentStatuses: ["declined", "granted"] },
    ]);
    const check = checks.find((check) => check.label === "Elder testimony consent");
    expect(check?.passed).toBe(true);
  });
});
