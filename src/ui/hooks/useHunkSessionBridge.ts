import { useCallback, useEffect } from "react";
import type { CliInput, DiffFile } from "../../core/types";
import { hunkLineRange } from "../../core/liveComments";
import { SessionBrokerClient } from "../../session-broker/brokerClient";
import type {
  AppliedCommentBatchResult,
  AppliedCommentResult,
  ClearedCommentsResult,
  HunkSessionServerMessage,
  ReloadedSessionResult,
  RemovedCommentResult,
  SessionLiveCommentSummary,
} from "../../hunk-session/types";
import type { ReviewController } from "./useReviewController";

/** Bridge one live Hunk review session to the local session daemon. */
export function useHunkSessionBridge({
  addLiveComment,
  addLiveCommentBatch,
  clearLiveComments,
  hostClient,
  liveCommentCount,
  liveCommentSummaries,
  navigateToLocation,
  openAgentNotes,
  reloadSession,
  removeLiveComment,
  selectedFile,
  selectedHunk,
  selectedHunkIndex,
  showAgentNotes,
}: {
  addLiveComment: ReviewController["addLiveComment"];
  addLiveCommentBatch: ReviewController["addLiveCommentBatch"];
  clearLiveComments: ReviewController["clearLiveComments"];
  hostClient?: SessionBrokerClient;
  liveCommentCount: number;
  liveCommentSummaries: SessionLiveCommentSummary[];
  navigateToLocation: ReviewController["navigateToLocation"];
  openAgentNotes: () => void;
  reloadSession: (
    nextInput: CliInput,
    options?: { resetApp?: boolean; sourcePath?: string },
  ) => Promise<ReloadedSessionResult>;
  removeLiveComment: ReviewController["removeLiveComment"];
  selectedFile: DiffFile | undefined;
  selectedHunk: DiffFile["metadata"]["hunks"][number] | undefined;
  selectedHunkIndex: number;
  showAgentNotes: boolean;
}) {
  const navigateToHunkSelection = useCallback(
    async (message: Extract<HunkSessionServerMessage, { command: "navigate_to_hunk" }>) =>
      navigateToLocation(message.input),
    [navigateToLocation],
  );

  const applyIncomingComment = useCallback(
    async (
      message: Extract<HunkSessionServerMessage, { command: "comment" }>,
    ): Promise<AppliedCommentResult> => {
      const result = addLiveComment(message.input, `mcp:${message.requestId}`, {
        reveal: message.input.reveal,
      });

      if (message.input.reveal ?? false) {
        openAgentNotes();
      }

      return result;
    },
    [addLiveComment, openAgentNotes],
  );

  const applyIncomingCommentBatch = useCallback(
    async (
      message: Extract<HunkSessionServerMessage, { command: "comment_batch" }>,
    ): Promise<AppliedCommentBatchResult> => {
      const result = addLiveCommentBatch(message.input.comments, message.requestId, {
        revealMode: message.input.revealMode,
      });

      if (message.input.revealMode === "first" && result.applied.length > 0) {
        openAgentNotes();
      }

      return result;
    },
    [addLiveCommentBatch, openAgentNotes],
  );

  const reloadIncomingSession = useCallback(
    async (message: Extract<HunkSessionServerMessage, { command: "reload_session" }>) =>
      reloadSession(message.input.nextInput, { sourcePath: message.input.sourcePath }),
    [reloadSession],
  );

  const removeIncomingComment = useCallback(
    async (
      message: Extract<HunkSessionServerMessage, { command: "remove_comment" }>,
    ): Promise<RemovedCommentResult> => removeLiveComment(message.input.commentId),
    [removeLiveComment],
  );

  const clearIncomingComments = useCallback(
    async (
      message: Extract<HunkSessionServerMessage, { command: "clear_comments" }>,
    ): Promise<ClearedCommentsResult> => clearLiveComments(message.input.filePath),
    [clearLiveComments],
  );

  useEffect(() => {
    if (!hostClient) {
      return;
    }

    hostClient.setBridge({
      applyComment: applyIncomingComment,
      applyCommentBatch: applyIncomingCommentBatch,
      navigateToHunk: navigateToHunkSelection,
      reloadSession: reloadIncomingSession,
      removeComment: removeIncomingComment,
      clearComments: clearIncomingComments,
    });

    return () => {
      hostClient.setBridge(null);
    };
  }, [
    applyIncomingComment,
    applyIncomingCommentBatch,
    clearIncomingComments,
    hostClient,
    navigateToHunkSelection,
    reloadIncomingSession,
    removeIncomingComment,
  ]);

  useEffect(() => {
    const selectedRange = selectedHunk ? hunkLineRange(selectedHunk) : undefined;

    hostClient?.updateSnapshot({
      updatedAt: new Date().toISOString(),
      state: {
        selectedFileId: selectedFile?.id,
        selectedFilePath: selectedFile?.path,
        selectedHunkIndex,
        selectedHunkOldRange: selectedRange?.oldRange,
        selectedHunkNewRange: selectedRange?.newRange,
        showAgentNotes,
        liveCommentCount,
        liveComments: liveCommentSummaries,
      },
    });
  }, [
    hostClient,
    liveCommentCount,
    liveCommentSummaries,
    selectedFile?.id,
    selectedFile?.path,
    selectedHunk,
    selectedHunkIndex,
    showAgentNotes,
  ]);
}
