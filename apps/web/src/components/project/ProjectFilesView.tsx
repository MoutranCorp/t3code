import type { EnvironmentId, ProjectReadFileResult } from "@t3tools/contracts";
import { formatAttachmentSize } from "@t3tools/client-runtime/state/attachments";
import { resolvePathLinkTarget } from "@t3tools/shared/fileLinks";
import {
  isWorkspaceAudioPreviewPath,
  isWorkspacePreviewEntryPath,
  isWorkspaceVideoPreviewPath,
} from "@t3tools/shared/filePreview";
import { ChevronRightIcon, FileSearchIcon, XIcon } from "lucide-react";
import { useState, type ReactNode } from "react";

import { cn } from "~/lib/utils";
import { OpenInPicker } from "../chat/OpenInPicker";
import { AttachmentFilePreview } from "../files/AttachmentFilePreview";
import FileBrowserPanel from "../files/FileBrowserPanel";
import { filePreviewReadErrorMessage } from "../files/filePreviewMode";
import {
  FILE_SURFACE_SUBHEADER_CLASS,
  FileSurfaceAction,
  FileSurfaceFailure,
  FileSurfaceLoading,
  FileSurfaceNotice,
} from "../files/fileSurfaceChrome";
import { useProjectFileQuery } from "../files/projectFilesQueryState";
import { useProjectOpenIn } from "./useProjectOpenIn";

/** Files the server signs a URL for; everything else is read as text. */
const isAssetPreviewPath = (path: string) =>
  isWorkspacePreviewEntryPath(path) ||
  isWorkspaceVideoPreviewPath(path) ||
  isWorkspaceAudioPreviewPath(path);

function splitRelativePath(relativePath: string) {
  const slash = relativePath.lastIndexOf("/");
  return {
    folder: slash < 0 ? null : relativePath.slice(0, slash),
    name: relativePath.slice(slash + 1),
  };
}

interface OpenFileProps {
  readonly environmentId: EnvironmentId;
  readonly cwd: string;
  readonly projectName: string;
  readonly relativePath: string;
  readonly onClose: () => void;
}

function fileOrigin(props: OpenFileProps) {
  return splitRelativePath(props.relativePath).folder ?? props.projectName;
}

/** Chrome for states AttachmentFilePreview does not render: loading, errors, binaries. */
function FileStateFrame(props: OpenFileProps & { readonly children: ReactNode }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background">
      <div className={FILE_SURFACE_SUBHEADER_CLASS}>
        <div className="flex min-w-0 flex-1 items-center text-xs">
          <span className="min-w-0 shrink truncate px-0.5 text-muted-foreground">
            {fileOrigin(props)}
          </span>
          <ChevronRightIcon className="mx-1 size-3.5 shrink-0 text-muted-foreground/60" />
          <span aria-current="page" className="min-w-0 truncate px-0.5 font-medium text-foreground">
            {splitRelativePath(props.relativePath).name}
          </span>
        </div>
        <FileSurfaceAction label="Close" onPress={props.onClose}>
          <XIcon className="size-3.5" />
        </FileSurfaceAction>
      </div>
      {props.children}
    </div>
  );
}

function AssetFile(props: OpenFileProps) {
  // AttachmentFilePreview keys its URL signing on this object, so it must keep its identity.
  const [asset] = useState(() => ({
    environmentId: props.environmentId,
    resource: {
      _tag: "draft-workspace-file" as const,
      cwd: props.cwd,
      path: resolvePathLinkTarget(props.relativePath, props.cwd),
    },
  }));
  return (
    <AttachmentFilePreview
      name={splitRelativePath(props.relativePath).name}
      mimeType="application/octet-stream"
      sizeBytes={0}
      asset={asset}
      origin={fileOrigin(props)}
      onClose={props.onClose}
    />
  );
}

function textBlob(contents: string) {
  return { contents, blob: new Blob([contents], { type: "text/plain" }) };
}

function TextFile(props: OpenFileProps & { readonly data: ProjectReadFileResult }) {
  const { contents } = props.data;
  // The viewer renders a Blob, which must keep its identity until the contents change.
  const [snapshot, setSnapshot] = useState(() => textBlob(contents));
  if (snapshot.contents !== contents) setSnapshot(textBlob(contents));
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      {props.data.truncated ? (
        <FileSurfaceNotice>
          Showing the first 1 MB of this {formatAttachmentSize(props.data.byteLength)} file. Open it
          in an editor to read the rest.
        </FileSurfaceNotice>
      ) : null}
      <AttachmentFilePreview
        name={splitRelativePath(props.relativePath).name}
        mimeType="text/plain"
        sizeBytes={snapshot.blob.size}
        file={snapshot.blob}
        origin={fileOrigin(props)}
        onClose={props.onClose}
      />
    </div>
  );
}

function BinaryFile(props: OpenFileProps) {
  const openIn = useProjectOpenIn(props.environmentId, props.projectName);
  return (
    <FileStateFrame {...props}>
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
        <div className="flex flex-col gap-1">
          <p className="text-sm font-medium text-foreground">No preview for this file</p>
          <p className="max-w-sm text-xs leading-relaxed text-muted-foreground">
            It is binary, so it opens in another app.
          </p>
        </div>
        {openIn.show ? (
          <OpenInPicker
            environmentId={props.environmentId}
            keybindings={openIn.keybindings}
            availableEditors={openIn.availableEditors}
            openInCwd={resolvePathLinkTarget(props.relativePath, props.cwd)}
            openInCwdIsFile
            enableShortcut={false}
          />
        ) : null}
      </div>
    </FileStateFrame>
  );
}

function OpenFile(
  props: OpenFileProps & { readonly file: ReturnType<typeof useProjectFileQuery> },
) {
  const { file, ...fileProps } = props;
  if (isAssetPreviewPath(props.relativePath)) return <AssetFile {...fileProps} />;
  if (file.data) return <TextFile {...fileProps} data={file.data} />;
  if (file.readError?.failure === "binary_file") return <BinaryFile {...fileProps} />;
  return (
    <FileStateFrame {...fileProps}>
      {file.error ? (
        <FileSurfaceFailure
          message={file.readError ? filePreviewReadErrorMessage(file.readError) : file.error}
          onRetry={file.refresh}
        />
      ) : (
        <FileSurfaceLoading />
      )}
    </FileStateFrame>
  );
}

/** The project's file tree beside a viewer for the open file. */
export function ProjectFilesView(props: {
  readonly environmentId: EnvironmentId;
  readonly cwd: string;
  readonly projectName: string;
  readonly openPath: string | null;
  readonly onOpenPath: (relativePath: string | null) => void;
}) {
  const { environmentId, cwd, openPath } = props;
  const textPath = openPath !== null && !isAssetPreviewPath(openPath) ? openPath : null;
  const file = useProjectFileQuery(environmentId, cwd, textPath, textPath !== null);
  return (
    <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden rounded-2xl border border-border/60 bg-background shadow-xs">
      <div
        className={cn(
          "min-h-0 shrink-0 flex-col border-border/60 md:flex md:w-72 md:border-r",
          openPath === null ? "flex w-full" : "hidden",
        )}
      >
        <FileBrowserPanel
          environmentId={environmentId}
          cwd={cwd}
          projectName={props.projectName}
          selectedPath={openPath}
          selectedPathRevealId={0}
          onOpenFile={props.onOpenPath}
          workspaceMutationId={null}
          {...(textPath === null ? {} : { onRefreshSelectedFile: file.refresh })}
        />
      </div>
      <div
        className={cn(
          "min-h-0 min-w-0 flex-1 flex-col",
          openPath === null ? "hidden md:flex" : "flex",
        )}
      >
        {openPath === null ? (
          <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
            <FileSearchIcon aria-hidden className="size-8 text-muted-foreground/50" />
            <p className="text-sm font-medium text-foreground">Pick a file to preview</p>
            <p className="max-w-xs text-xs leading-relaxed text-muted-foreground">
              Markdown, code, tables, images, PDFs and web pages open right here.
            </p>
          </div>
        ) : (
          <OpenFile
            key={`${environmentId}:${cwd}:${openPath}`}
            environmentId={environmentId}
            cwd={cwd}
            projectName={props.projectName}
            relativePath={openPath}
            file={file}
            onClose={() => props.onOpenPath(null)}
          />
        )}
      </div>
    </div>
  );
}
