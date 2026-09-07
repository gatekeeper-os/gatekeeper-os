# @clawos/gatekeeper-fs

The first driver (Phase 3): no OAuth, observer strategy **low-stakes**. A grant is a directory under one of `config.roots`;
introduced with a `file:///abs/path` URL. Gives a sandboxed agent *scoped* host filesystem access without `group:fs`.
Observations: `gk_fs_dir_list`, `gk_fs_file_read`. Actions: `gk_fs_file_write` (simulated via overlay; applied on approval).
