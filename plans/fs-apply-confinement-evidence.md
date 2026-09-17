# Filesystem apply design: syscall counterexamples

These are **design diagnostics**, not a product implementation, unit acceptance
or VM checkpoint. Executed on Linux6.18.50, x86_64, 2026-09-16. Both schedules
reproduced a contract violation in the proposed check-then-rename approach.
Fixtures use disposable temporary directories only; the existing driver remains
unchanged and still refuses application. No production data or Gateway is used.

The host environment supported actual `openat2` with `RESOLVE_BENEATH`,
`RESOLVE_NO_SYMLINKS` and `RESOLVE_NO_XDEV`. A hostile parent move after the final
identity check still redirected publication outside the grant. Separately, an
external final-name replacement after baseline validation was silently replaced
by the subsequent rename. An after-the-fact desired-content hash did not reveal
the lost external edit. No mount-changing or privileged experiment was performed.

## Recorded output

```json
{
  "scope": "design-only counterexamples, not product or VM acceptance",
  "platform": "Linux",
  "architecture": "x86_64",
  "kernel": "6.18.50",
  "cases": {
    "parent_move_after_openat2_and_final_check": {
      "openat2_strict_resolution_succeeded": true,
      "target_published_outside_granted_root": true,
      "postcheck_detects_but_cannot_prevent_effect": true,
      "original_grant_path_has_no_target": true
    },
    "final_name_change_after_baseline_check": {
      "external_replacement_had_different_inode": true,
      "external_edit_overwritten": true,
      "postcommit_content_hash_matches_desired_despite_lost_edit": true
    }
  }
}
```

## Reproducible diagnostic

Run this Python3 program only in a disposable test environment. Exit0 means the
two **unsafe-schedule counterexamples were reproduced**, not that confinement
passed. Unsupported architecture or unavailable syscall fails rather than
silently falling back. Linux syscall437 is used only on x86_64/aarch64; only
x86_64 was executed here. Save the following block as a temporary `.py` file.

```python
"""Design-only syscall counterexamples. Disposable fixtures; no product writes."""
import ctypes, os, platform, tempfile, json, hashlib
from pathlib import Path
class OpenHow(ctypes.Structure):
    _fields_=[('flags',ctypes.c_uint64),('mode',ctypes.c_uint64),('resolve',ctypes.c_uint64)]
def beneath(dfd, path):
    if platform.machine() not in ('x86_64','aarch64'):raise RuntimeError('Unverified syscall number on architecture')
    libc=ctypes.CDLL(None,use_errno=True)
    # Linux openat2: beneath, no symlinks, no mount crossings (also forbids magic links).
    how=OpenHow(os.O_RDONLY|os.O_DIRECTORY|os.O_CLOEXEC,0,0x08|0x04|0x01)
    fd=libc.syscall(ctypes.c_long(437),ctypes.c_int(dfd),ctypes.c_char_p(path.encode()),ctypes.byref(how),ctypes.sizeof(how))
    if fd<0:raise OSError(ctypes.get_errno(),os.strerror(ctypes.get_errno()))
    return fd
def identity(p):
    s=p.stat(follow_symlinks=False)
    return (s.st_dev,s.st_ino,s.st_nlink,s.st_size,s.st_mtime_ns,s.st_ctime_ns)
result={'scope':'design-only counterexamples, not product or VM acceptance','platform':platform.system(),'architecture':platform.machine(),'kernel':platform.release(),'cases':{}}
with tempfile.TemporaryDirectory(prefix='fs-confinement-design-') as d:
    base=Path(d);root=base/'grant';root.mkdir();parent=root/'parent';parent.mkdir();outside=base/'outside';outside.mkdir()
    (parent/'target').write_text('approved baseline')
    rootfd=os.open(root,os.O_RDONLY|os.O_DIRECTORY)
    fd=beneath(rootfd,'parent')
    try:
        tmp=os.open('.stage',os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600,dir_fd=fd)
        os.write(tmp,b'approved new content');os.fsync(tmp);os.close(tmp)
        expected=identity(parent)
        assert os.fstat(fd).st_ino==expected[1]
        assert Path(os.readlink('/proc/self/fd/'+str(fd)))==parent
        # Hostile fixture is scheduled AFTER the last identity/containment check.
        os.rename(parent,outside/'moved');parent.mkdir()
        os.rename('.stage','target',src_dir_fd=fd,dst_dir_fd=fd);os.fsync(fd)
        result['cases']['parent_move_after_openat2_and_final_check']={
          'openat2_strict_resolution_succeeded':True,
          'target_published_outside_granted_root':(outside/'moved'/'target').read_text()=='approved new content',
          'postcheck_detects_but_cannot_prevent_effect':identity(parent)!=expected,
          'original_grant_path_has_no_target':not(parent/'target').exists()}
    finally:os.close(fd);os.close(rootfd)
    folder=root/'cas';folder.mkdir();dest=folder/'target';dest.write_text('approved baseline');baseline=identity(dest)
    staged=folder/'.stage';staged.write_text('approved new content')
    fd=os.open(folder,os.O_RDONLY|os.O_DIRECTORY)
    try:
        assert identity(dest)==baseline
        # Hostile replacement after exact inode/content baseline check, before rename.
        external=folder/'external';external.write_text('external edit must survive');os.replace(external,dest)
        swapped=identity(dest)
        os.rename('.stage','target',src_dir_fd=fd,dst_dir_fd=fd);os.fsync(fd)
        result['cases']['final_name_change_after_baseline_check']={
          'external_replacement_had_different_inode':swapped[1]!=baseline[1],
          'external_edit_overwritten':dest.read_text()=='approved new content',
          'postcommit_content_hash_matches_desired_despite_lost_edit':hashlib.sha256(dest.read_bytes()).hexdigest()==hashlib.sha256(b'approved new content').hexdigest()}
    finally:os.close(fd)
assert all(all(v for v in case.values()) for case in result['cases'].values())
print(json.dumps(result,indent=2))
```
