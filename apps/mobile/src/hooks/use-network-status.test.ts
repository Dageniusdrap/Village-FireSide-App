import { act, renderHook, waitFor } from "@testing-library/react-native";
import NetInfo from "@react-native-community/netinfo";

import { useNetworkStatus } from "./use-network-status";

jest.mock("@react-native-community/netinfo", () => ({
  __esModule: true,
  default: { fetch: jest.fn(), addEventListener: jest.fn() },
}));

const mockFetch = NetInfo.fetch as jest.Mock;
const mockAddEventListener = NetInfo.addEventListener as jest.Mock;

describe("useNetworkStatus", () => {
  beforeEach(() => {
    mockAddEventListener.mockReturnValue(() => {});
  });

  it("starts as null before the first reading resolves", async () => {
    mockFetch.mockReturnValue(new Promise(() => {})); // never resolves in this test
    const { result } = await renderHook(() => useNetworkStatus());
    expect(result.current.isConnected).toBeNull();
  });

  it("reflects the initial fetch result", async () => {
    mockFetch.mockResolvedValue({ isConnected: false });
    const { result } = await renderHook(() => useNetworkStatus());
    await waitFor(() => expect(result.current.isConnected).toBe(false));
  });

  it("updates when the NetInfo listener fires", async () => {
    mockFetch.mockResolvedValue({ isConnected: true });
    let listener: ((state: { isConnected: boolean }) => void) | undefined;
    mockAddEventListener.mockImplementation((cb) => {
      listener = cb;
      return () => {};
    });

    const { result } = await renderHook(() => useNetworkStatus());
    await waitFor(() => expect(result.current.isConnected).toBe(true));

    await act(async () => {
      listener?.({ isConnected: false });
    });
    expect(result.current.isConnected).toBe(false);
  });
});
