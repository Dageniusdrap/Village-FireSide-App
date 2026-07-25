import { act, renderHook } from "@testing-library/react-native";

import { useAuthStore } from "@/stores/auth-store";

import { useRequireAuth } from "./use-require-auth";

jest.mock("@/stores/auth-store", () => ({
  useAuthStore: jest.fn(),
}));

type MockState = { session: { id: string } | null; guestMode: boolean };

const mockUseAuthStore = useAuthStore as unknown as jest.Mock;

function mockStoreState(state: MockState) {
  mockUseAuthStore.mockImplementation((selector: (s: MockState) => unknown) => selector(state));
}

describe("useRequireAuth", () => {
  it("calls the action immediately when signed in", async () => {
    mockStoreState({ session: { id: "user-1" }, guestMode: false });
    const { result } = await renderHook(() => useRequireAuth());
    const action = jest.fn();

    await act(() => {
      result.current.requireAuth(action);
    });

    expect(action).toHaveBeenCalledTimes(1);
    expect(result.current.promptVisible).toBe(false);
  });

  it("opens the sign-in prompt instead of running the action in guest mode", async () => {
    mockStoreState({ session: null, guestMode: true });
    const { result } = await renderHook(() => useRequireAuth());
    const action = jest.fn();

    await act(() => {
      result.current.requireAuth(action);
    });

    expect(action).not.toHaveBeenCalled();
    expect(result.current.promptVisible).toBe(true);
  });

  it("dismissPrompt closes the prompt", async () => {
    mockStoreState({ session: null, guestMode: true });
    const { result } = await renderHook(() => useRequireAuth());

    await act(() => {
      result.current.requireAuth(jest.fn());
    });
    expect(result.current.promptVisible).toBe(true);

    await act(() => {
      result.current.dismissPrompt();
    });
    expect(result.current.promptVisible).toBe(false);
  });

  it("does nothing when neither signed in nor in guest mode", async () => {
    mockStoreState({ session: null, guestMode: false });
    const { result } = await renderHook(() => useRequireAuth());
    const action = jest.fn();

    await act(() => {
      result.current.requireAuth(action);
    });

    expect(action).not.toHaveBeenCalled();
    expect(result.current.promptVisible).toBe(false);
  });
});
