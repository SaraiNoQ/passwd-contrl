import { beforeEach, describe, expect, it, vi } from "vitest";

type PopupStateResponse = {
  origin?: string;
  blockedReason?: string;
  credentials: Array<{
    id: string;
    title: string;
    origin: string;
    username: string;
    matchType: string;
  }>;
};

type SendMessageCallback = (response: unknown) => void;

// Track all sendMessage calls and their callbacks
let sendMessageCalls: Array<{ message: unknown; callback: SendMessageCallback | undefined }> = [];

// Popup callback captured from module load (persisted across beforeEach)
let popupCallbackFromModuleLoad: SendMessageCallback | undefined;

vi.stubGlobal("chrome", {
  runtime: {
    sendMessage: vi.fn((message: unknown, callback?: SendMessageCallback) => {
      sendMessageCalls.push({ message, callback });
      if ((message as { type?: string })?.type === "GET_POPUP_STATE" && callback) {
        popupCallbackFromModuleLoad = callback;
      }
    }),
    lastError: null
  },
  tabs: {
    query: vi.fn()
  },
  scripting: {
    executeScript: vi.fn()
  }
});

// Set up DOM BEFORE module import so element references are captured correctly.
// popup.ts captures getElementById("root") etc. at module scope.
document.body.innerHTML = `
  <h1>Zero Vault <span id="version"></span></h1>
  <div id="connection-status"></div>
  <button id="scan" type="button">Scan</button>
  <div id="root"></div>
`;

// Module import triggers refresh() which calls chrome.runtime.sendMessage once
await import("./popup");

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

const root = document.getElementById("root")!;

const renderState = (state: PopupStateResponse) => {
  if (!popupCallbackFromModuleLoad) throw new Error("popup callback not captured from module load");
  popupCallbackFromModuleLoad(state);
};

const getSendMessageCallsForType = (type: string) =>
  sendMessageCalls.filter((c) => (c.message as { type?: string })?.type === type);

const twoExactCredentialsState: PopupStateResponse = {
  origin: "https://example.com",
  credentials: [
    { id: "cred-1", title: "Personal", origin: "https://example.com", username: "alice", matchType: "exact" },
    { id: "cred-2", title: "Work", origin: "https://example.com", username: "bob", matchType: "exact" }
  ]
};

beforeEach(() => {
  // Clear only the root element content, not the whole body (to preserve captured element refs)
  root.innerHTML = "";
  sendMessageCalls = [];
});

describe("popup keyboard navigation", () => {
  it("ArrowDown cycles selection forward and adds selected class", async () => {
    renderState(twoExactCredentialsState);
    await flush();

    const buttons = root.querySelectorAll<HTMLButtonElement>(".credential[data-credential-id]");
    expect(buttons).toHaveLength(2);
    expect(buttons[0]!.classList.contains("selected")).toBe(true);
    expect(buttons[1]!.classList.contains("selected")).toBe(false);

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    expect(buttons[0]!.classList.contains("selected")).toBe(false);
    expect(buttons[1]!.classList.contains("selected")).toBe(true);

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    expect(buttons[0]!.classList.contains("selected")).toBe(true);
    expect(buttons[1]!.classList.contains("selected")).toBe(false);
  });

  it("ArrowUp cycles selection backward", async () => {
    renderState(twoExactCredentialsState);
    await flush();

    const buttons = root.querySelectorAll<HTMLButtonElement>(".credential[data-credential-id]");

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }));
    expect(buttons[1]!.classList.contains("selected")).toBe(true);
    expect(buttons[0]!.classList.contains("selected")).toBe(false);
  });

  it("Enter fills the currently selected exact credential", async () => {
    renderState(twoExactCredentialsState);
    await flush();
    sendMessageCalls = [];

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await flush();

    const fillCalls = getSendMessageCallsForType("FILL_MATCHED_CREDENTIAL");
    expect(fillCalls).toHaveLength(1);
    expect(fillCalls[0]!.message).toMatchObject({ type: "FILL_MATCHED_CREDENTIAL", credentialId: "cred-1" });
  });

  it("Enter fills the second credential after ArrowDown", async () => {
    renderState(twoExactCredentialsState);
    await flush();
    sendMessageCalls = [];

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await flush();

    const fillCalls = getSendMessageCallsForType("FILL_MATCHED_CREDENTIAL");
    expect(fillCalls).toHaveLength(1);
    expect(fillCalls[0]!.message).toMatchObject({ type: "FILL_MATCHED_CREDENTIAL", credentialId: "cred-2" });
  });

  it("Enter does not fill a similar (non-acknowledged) credential", async () => {
    renderState({
      origin: "https://sub.example.com",
      credentials: [
        { id: "cred-similar", title: "Example", origin: "https://example.com", username: "alice", matchType: "similar" }
      ]
    });
    await flush();
    sendMessageCalls = [];

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await flush();

    const fillCalls = getSendMessageCallsForType("FILL_MATCHED_CREDENTIAL");
    expect(fillCalls).toHaveLength(0);
  });

  it("Enter fills a similar credential after clicking acknowledge button", async () => {
    renderState({
      origin: "https://sub.example.com",
      credentials: [
        { id: "cred-similar", title: "Example", origin: "https://example.com", username: "alice", matchType: "similar" }
      ]
    });
    await flush();
    sendMessageCalls = [];

    // Initially, Enter should not fill a similar (non-acknowledged) credential
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await flush();
    expect(getSendMessageCallsForType("FILL_MATCHED_CREDENTIAL")).toHaveLength(0);

    // Click the acknowledge button
    const ackBtn = root.querySelector<HTMLButtonElement>(".acknowledge-btn");
    expect(ackBtn).toBeTruthy();
    ackBtn!.click();

    // The ack handler sends ACKNOWLEDGE_SIMILAR_ORIGIN; simulate the background response
    const ackCalls = getSendMessageCallsForType("ACKNOWLEDGE_SIMILAR_ORIGIN");
    expect(ackCalls).toHaveLength(1);
    expect(ackCalls[0]!.message).toMatchObject({ type: "ACKNOWLEDGE_SIMILAR_ORIGIN", credentialId: "cred-similar" });
    // Invoke the callback as the background would (simulating successful acknowledgment)
    ackCalls[0]!.callback?.({ ok: true });
    await flush();

    // After acknowledgment, the credential's matchType changes to "acknowledged"
    const credButton = root.querySelector<HTMLButtonElement>(".credential[data-credential-id='cred-similar']");
    expect(credButton).toBeTruthy();
    expect(credButton!.dataset.matchType).toBe("acknowledged");

    // Now Enter should fill the acknowledged credential
    sendMessageCalls = [];
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await flush();

    const fillCalls = getSendMessageCallsForType("FILL_MATCHED_CREDENTIAL");
    expect(fillCalls).toHaveLength(1);
    expect(fillCalls[0]!.message).toMatchObject({ type: "FILL_MATCHED_CREDENTIAL", credentialId: "cred-similar" });
  });

  it("does nothing on arrow keys when no credentials are displayed", async () => {
    renderState({ origin: "https://example.com", credentials: [], blockedReason: "没有匹配的凭据" });
    await flush();
    sendMessageCalls = [];

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await flush();

    const fillCalls = getSendMessageCallsForType("FILL_MATCHED_CREDENTIAL");
    expect(fillCalls).toHaveLength(0);
  });
});
