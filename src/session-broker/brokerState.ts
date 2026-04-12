import { randomUUID } from "node:crypto";
import {
  buildHunkSessionReview,
  buildListedHunkSession,
  buildSelectedHunkSessionContext,
  listHunkSessionComments,
} from "../hunk-session/projections";
import type {
  AppliedCommentBatchResult,
  AppliedCommentResult,
  ClearedCommentsResult,
  ClearCommentsToolInput,
  CommentBatchToolInput,
  CommentToolInput,
  HunkSessionCommandResult,
  HunkSessionRegistration,
  HunkSessionServerMessage,
  HunkSessionSnapshot,
  ListedSession,
  NavigateToHunkToolInput,
  NavigatedSelectionResult,
  ReloadSessionToolInput,
  ReloadedSessionResult,
  RemoveCommentToolInput,
  RemovedCommentResult,
  SelectedSessionContext,
  SessionReview,
} from "../hunk-session/types";
import { parseSessionRegistration, parseSessionSnapshot } from "../hunk-session/wire";
import { matchesSessionSelector } from "./selectors";
import type { SessionTargetInput } from "./types";

interface PendingCommand {
  sessionId: string;
  resolve: (result: HunkSessionCommandResult) => void;
  reject: (error: Error) => void;
  timeout: Timer;
}

interface DaemonSessionSocket {
  send(data: string): unknown;
}

interface SessionEntry {
  registration: HunkSessionRegistration;
  snapshot: HunkSessionSnapshot;
  socket: DaemonSessionSocket;
  connectedAt: string;
  lastSeenAt: string;
}

export type UpdateSnapshotResult = "updated" | "invalid" | "not-found";

export interface SessionTargetSelector {
  sessionId?: string;
  sessionPath?: string;
  repoRoot?: string;
}

function describeSessionChoices(sessions: ListedSession[]) {
  return sessions.map((session) => `${session.sessionId} (${session.title})`).join(", ");
}

/** Resolve which live session one external command should target. */
export function resolveSessionTarget(sessions: ListedSession[], selector: SessionTargetSelector) {
  if (selector.sessionId) {
    const matched = sessions.find((session) => matchesSessionSelector(session, selector));
    if (!matched) {
      throw new Error(`No active session matches sessionId ${selector.sessionId}.`);
    }

    return matched;
  }

  const sessionPath = selector.sessionPath;
  if (sessionPath) {
    const matches = sessions.filter((session) => matchesSessionSelector(session, selector));
    if (matches.length === 0) {
      throw new Error(`No active session matches session path ${sessionPath}.`);
    }

    if (matches.length > 1) {
      throw new Error(
        `Multiple active sessions match session path ${sessionPath}; specify sessionId instead. ` +
          `Matches: ${describeSessionChoices(matches)}.`,
      );
    }

    return matches[0]!;
  }

  if (selector.repoRoot) {
    const matches = sessions.filter((session) => matchesSessionSelector(session, selector));
    if (matches.length === 0) {
      throw new Error(`No active session matches repoRoot ${selector.repoRoot}.`);
    }

    if (matches.length > 1) {
      throw new Error(
        `Multiple active sessions match repoRoot ${selector.repoRoot}; specify sessionId instead. ` +
          `Matches: ${describeSessionChoices(matches)}.`,
      );
    }

    return matches[0]!;
  }

  if (sessions.length === 1) {
    return sessions[0]!;
  }

  if (sessions.length === 0) {
    throw new Error(
      "No active sessions are registered with the broker. Open the app and wait for it to connect.",
    );
  }

  throw new Error(
    `Multiple active sessions are registered; specify sessionId, sessionPath, or repoRoot. ` +
      `Sessions: ${describeSessionChoices(sessions)}.`,
  );
}

/** Track registered sessions and route broker commands onto the correct live app instance. */
export class SessionBrokerState {
  private sessions = new Map<string, SessionEntry>();
  private sessionIdsBySocket = new Map<DaemonSessionSocket, string>();
  private pendingCommands = new Map<string, PendingCommand>();

  listSessions(): ListedSession[] {
    return [...this.sessions.values()]
      .map(buildListedHunkSession)
      .sort((left, right) => right.snapshot.updatedAt.localeCompare(left.snapshot.updatedAt));
  }

  getSession(selector: SessionTargetSelector) {
    return resolveSessionTarget(this.listSessions(), selector);
  }

  /** Return the live session's loaded review model, with raw patch text included only on demand. */
  getSessionReview(
    selector: SessionTargetSelector,
    options: { includePatch?: boolean } = {},
  ): SessionReview {
    return buildHunkSessionReview(this.getSessionEntry(selector), options);
  }

  getSelectedContext(selector: SessionTargetSelector): SelectedSessionContext {
    return buildSelectedHunkSessionContext(this.getSession(selector));
  }

  listComments(selector: SessionTargetSelector, filter: { filePath?: string } = {}) {
    return listHunkSessionComments(this.getSession(selector), filter);
  }

  getSessionCount() {
    return this.sessions.size;
  }

  getPendingCommandCount() {
    return this.pendingCommands.size;
  }

  registerSession(socket: DaemonSessionSocket, registrationInput: unknown, snapshotInput: unknown) {
    const registration = parseSessionRegistration(registrationInput);
    const snapshot = parseSessionSnapshot(snapshotInput);
    if (!registration || !snapshot) {
      const previousSessionId = this.sessionIdsBySocket.get(socket);
      if (previousSessionId) {
        // Drop any stale session already tied to this socket so an incompatible replacement
        // payload cannot leave old review data behind after an upgrade or reload.
        this.removeSession(
          previousSessionId,
          new Error("The session sent an incompatible registration payload."),
        );
      }

      return false;
    }

    const previousSessionId = this.sessionIdsBySocket.get(socket);
    if (previousSessionId && previousSessionId !== registration.sessionId) {
      this.unregisterSocket(socket);
    }

    const existing = this.sessions.get(registration.sessionId);
    if (existing && existing.socket !== socket) {
      this.sessionIdsBySocket.delete(existing.socket);
      this.rejectPendingCommandsForSession(
        registration.sessionId,
        new Error("Session reconnected before the command completed."),
      );
    }

    const now = new Date().toISOString();
    this.sessions.set(registration.sessionId, {
      registration,
      snapshot,
      socket,
      connectedAt: now,
      lastSeenAt: now,
    });
    this.sessionIdsBySocket.set(socket, registration.sessionId);
    return true;
  }

  updateSnapshot(sessionId: string, snapshotInput: unknown): UpdateSnapshotResult {
    const entry = this.sessions.get(sessionId);
    if (!entry) {
      return "not-found";
    }

    const snapshot = parseSessionSnapshot(snapshotInput);
    if (!snapshot) {
      return "invalid";
    }

    this.sessions.set(sessionId, {
      ...entry,
      snapshot,
      lastSeenAt: new Date().toISOString(),
    });
    return "updated";
  }

  markSessionSeen(sessionId: string) {
    const entry = this.sessions.get(sessionId);
    if (!entry) {
      return;
    }

    this.sessions.set(sessionId, {
      ...entry,
      lastSeenAt: new Date().toISOString(),
    });
  }

  unregisterSocket(socket: DaemonSessionSocket) {
    const sessionId = this.sessionIdsBySocket.get(socket);
    if (!sessionId) {
      return;
    }

    this.removeSession(sessionId, new Error("The targeted session disconnected."));
  }

  pruneStaleSessions({ ttlMs, now = Date.now() }: { ttlMs: number; now?: number }) {
    let removed = 0;
    const cutoff = now - ttlMs;

    for (const [sessionId, entry] of this.sessions.entries()) {
      const lastSeenAt = Date.parse(entry.lastSeenAt);
      if (!Number.isFinite(lastSeenAt) || lastSeenAt > cutoff) {
        continue;
      }

      this.removeSession(
        sessionId,
        new Error("The targeted session became stale and was removed from the session broker."),
      );
      removed += 1;
    }

    return removed;
  }

  /** Dispatch one app-owned command through the generic broker transport. */
  dispatchCommand<
    ResultType extends HunkSessionCommandResult,
    CommandName extends HunkSessionServerMessage["command"],
  >({
    selector,
    command,
    input,
    timeoutMessage,
    timeoutMs = 15_000,
  }: {
    selector: SessionTargetInput;
    command: CommandName;
    input: Extract<HunkSessionServerMessage, { command: CommandName }>["input"];
    timeoutMessage: string;
    timeoutMs?: number;
  }) {
    const session = resolveSessionTarget(this.listSessions(), selector);
    const requestId = randomUUID();

    return new Promise<ResultType>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingCommands.delete(requestId);
        reject(new Error(timeoutMessage));
      }, timeoutMs);

      this.pendingCommands.set(requestId, {
        sessionId: session.sessionId,
        resolve: (result) => resolve(result as ResultType),
        reject,
        timeout,
      });

      const entry = this.sessions.get(session.sessionId);
      if (!entry) {
        clearTimeout(timeout);
        this.pendingCommands.delete(requestId);
        reject(new Error("The targeted session is no longer connected."));
        return;
      }

      try {
        const message = {
          type: "command",
          requestId,
          command,
          input,
        } as Extract<HunkSessionServerMessage, { command: CommandName }>;

        entry.socket.send(JSON.stringify(message));
      } catch (error) {
        clearTimeout(timeout);
        this.pendingCommands.delete(requestId);
        reject(
          error instanceof Error
            ? error
            : new Error("The targeted session could not receive the command."),
        );
      }
    });
  }

  /** Keep temporary Hunk-oriented helpers while callers migrate onto generic dispatch. */
  sendComment(input: CommentToolInput) {
    return this.dispatchCommand<AppliedCommentResult, "comment">({
      selector: {
        sessionId: input.sessionId,
        sessionPath: input.sessionPath,
        repoRoot: input.repoRoot,
      },
      command: "comment",
      input,
      timeoutMessage: "Timed out waiting for the session to apply the comment.",
    });
  }

  sendCommentBatch(input: CommentBatchToolInput) {
    return this.dispatchCommand<AppliedCommentBatchResult, "comment_batch">({
      selector: {
        sessionId: input.sessionId,
        sessionPath: input.sessionPath,
        repoRoot: input.repoRoot,
      },
      command: "comment_batch",
      input,
      timeoutMessage: "Timed out waiting for the session to apply the comment batch.",
      timeoutMs: 30_000,
    });
  }

  sendNavigateToHunk(input: NavigateToHunkToolInput) {
    return this.dispatchCommand<NavigatedSelectionResult, "navigate_to_hunk">({
      selector: {
        sessionId: input.sessionId,
        sessionPath: input.sessionPath,
        repoRoot: input.repoRoot,
      },
      command: "navigate_to_hunk",
      input,
      timeoutMessage: "Timed out waiting for the session to navigate to the requested hunk.",
    });
  }

  sendReloadSession(input: ReloadSessionToolInput) {
    return this.dispatchCommand<ReloadedSessionResult, "reload_session">({
      selector: {
        sessionId: input.sessionId,
        sessionPath: input.sessionPath,
        repoRoot: input.repoRoot,
      },
      command: "reload_session",
      input,
      timeoutMessage: "Timed out waiting for the session to reload the requested contents.",
      timeoutMs: 30_000,
    });
  }

  sendRemoveComment(input: RemoveCommentToolInput) {
    return this.dispatchCommand<RemovedCommentResult, "remove_comment">({
      selector: {
        sessionId: input.sessionId,
        sessionPath: input.sessionPath,
        repoRoot: input.repoRoot,
      },
      command: "remove_comment",
      input,
      timeoutMessage: "Timed out waiting for the session to remove the requested comment.",
    });
  }

  sendClearComments(input: ClearCommentsToolInput) {
    return this.dispatchCommand<ClearedCommentsResult, "clear_comments">({
      selector: {
        sessionId: input.sessionId,
        sessionPath: input.sessionPath,
        repoRoot: input.repoRoot,
      },
      command: "clear_comments",
      input,
      timeoutMessage: "Timed out waiting for the session to clear the requested comments.",
    });
  }

  handleCommandResult(message: {
    requestId: string;
    ok: boolean;
    result?: HunkSessionCommandResult;
    error?: string;
  }) {
    const pending = this.pendingCommands.get(message.requestId);
    if (!pending) {
      return;
    }

    clearTimeout(pending.timeout);
    this.pendingCommands.delete(message.requestId);

    if (message.ok && message.result) {
      pending.resolve(message.result);
      return;
    }

    pending.reject(new Error(message.error ?? "The session failed to handle the command."));
  }

  shutdown(error = new Error("The session broker daemon shut down.")) {
    for (const [requestId, pending] of this.pendingCommands.entries()) {
      clearTimeout(pending.timeout);
      this.pendingCommands.delete(requestId);
      pending.reject(error);
    }

    this.sessionIdsBySocket.clear();
    this.sessions.clear();
  }

  /** Resolve one live session selector into the full in-memory registration entry. */
  private getSessionEntry(selector: SessionTargetSelector) {
    const session = resolveSessionTarget(this.listSessions(), selector);
    const entry = this.sessions.get(session.sessionId);
    if (!entry) {
      throw new Error("The targeted session is no longer connected.");
    }

    return entry;
  }

  private removeSession(sessionId: string, error: Error) {
    const entry = this.sessions.get(sessionId);
    if (!entry) {
      return;
    }

    this.sessions.delete(sessionId);
    if (this.sessionIdsBySocket.get(entry.socket) === sessionId) {
      this.sessionIdsBySocket.delete(entry.socket);
    }

    this.rejectPendingCommandsForSession(sessionId, error);
  }

  private rejectPendingCommandsForSession(sessionId: string, error: Error) {
    for (const [requestId, pending] of this.pendingCommands.entries()) {
      if (pending.sessionId !== sessionId) {
        continue;
      }

      clearTimeout(pending.timeout);
      this.pendingCommands.delete(requestId);
      pending.reject(error);
    }
  }
}
