/** STOP 1-approved filesystem surface; STOP 2 approved; host-file application remains fail closed. */
import { Type } from "typebox";
import { GrantHandle, type GatekeeperToolDef } from "@gatekeeper-os/shared";

const closed = { additionalProperties: false };
const relativePath = Type.String({ minLength: 1, maxLength: 4096 });

/** List, read and write within a directory capability; never registers upstream tools. */
export const fsTools: GatekeeperToolDef[] = [
  {
    name: "gk_fs_dir_list", resourceType: "dir", kind: "observation",
    description: "List the immediate files and folders in the directory or a relative subdirectory.",
    parameters: Type.Object({ grant: GrantHandle, subpath: Type.Optional(relativePath) }, closed),
    outputSchema: Type.Object({ entries: Type.Array(Type.Object({
      name: Type.String(), kind: Type.Enum(["file", "directory", "unavailable"]),
    }, closed), { maxItems: 1000 }) }, closed),
  },
  {
    name: "gk_fs_file_read", resourceType: "dir", kind: "observation",
    description: "Read a UTF-8 text file of up to 1 MiB at a relative path inside the directory.",
    parameters: Type.Object({ grant: GrantHandle, path: relativePath }, closed),
    outputSchema: Type.Object({ path: relativePath, content: Type.String({ maxLength: 1048576 }) }, closed),
  },
  {
    name: "gk_fs_file_write", resourceType: "dir", kind: "action",
    description: "Create or replace a UTF-8 text file of up to 1 MiB at a relative path inside the directory.",
    parameters: Type.Object({ grant: GrantHandle, path: relativePath,
      content: Type.String({ maxLength: 1048576 }) }, closed),
    outputSchema: Type.Object({ path: relativePath, bytes: Type.Integer({ minimum: 0, maximum: 1048576 }) }, closed),
  },
];
