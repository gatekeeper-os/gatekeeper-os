# Read-only publication barrier. No credentials, installs, registry writes, or extraction.
# Usage: python3 scripts/verify-release-listing.py VERSION [latest]
import base64, hashlib, io, json, re, sys, tarfile, urllib.request
from datetime import datetime, timezone
from urllib.parse import quote, urlparse

if len(sys.argv) not in (2, 3) or (len(sys.argv) == 3 and sys.argv[2] != 'latest'):
    raise SystemExit('Usage: verify-release-listing.py VERSION [latest]')
version = sys.argv[1]
if not re.fullmatch(r'\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?', version):
    raise SystemExit('Exact version required')
require_latest = len(sys.argv) > 2 and sys.argv[2] == 'latest'
registry = 'https://registry.npmjs.org'
names = ['@gatekeeper-os/' + s for s in ['shared', 'gatekeeper-kit', 'kernel', 'gatekeeper-fs', 'cli']]
receipt = {'version': version, 'checkedAt': datetime.now(timezone.utc).isoformat(), 'packages': []}
def fetch(url):
    req = urllib.request.Request(url, headers={'Accept': 'application/json', 'Cache-Control': 'no-cache'})
    with urllib.request.urlopen(req, timeout=30) as response:
        return response.read()
def check(condition, message):
    if not condition:
        raise RuntimeError(message)
for name in names:
    path = registry + '/' + quote(name, safe='@')
    listing, exact, tags = [json.loads(fetch(url)) for url in [path, path + '/' + version, registry + '/-/package/' + quote(name, safe='@') + '/dist-tags']]
    listed = listing.get('versions', {}).get(version)
    check(listed is not None, name + ': version missing from listing')
    check(listing.get('time', {}).get(version), name + ': publication time missing')
    for document in [listed, exact]:
        check(document.get('name') == name and document.get('version') == version, name + ': identity mismatch')
        check(not document.get('deprecated'), name + ': target version deprecated')
    for surface in [listing.get('dist-tags', {}), tags]:
        check(surface.get('beta') == version, name + ': beta tag inconsistent')
        if require_latest:
            check(surface.get('latest') == version, name + ': latest tag inconsistent')
    check(listed['dist']['integrity'] == exact['dist']['integrity'] and listed['dist']['tarball'] == exact['dist']['tarball'], name + ': metadata surfaces disagree')
    url = exact['dist']['tarball']
    check(urlparse(url).scheme == 'https' and urlparse(url).netloc == 'registry.npmjs.org', name + ': unexpected archive origin')
    archive = fetch(url)
    integrity = 'sha512-' + base64.b64encode(hashlib.sha512(archive).digest()).decode()
    check(integrity == exact['dist']['integrity'], name + ': archive integrity mismatch')
    with tarfile.open(fileobj=io.BytesIO(archive), mode='r:gz') as tar:
        packed = json.load(tar.extractfile('package/package.json'))
    check(packed['name'] == name and packed['version'] == version, name + ': archive identity mismatch')
    pins = {}
    for field in ['dependencies', 'optionalDependencies', 'peerDependencies']:
        check(packed.get(field, {}) == exact.get(field, {}) == listed.get(field, {}), name + ': packed dependency metadata mismatch')
        for dep, pin in packed.get(field, {}).items():
            if dep.startswith('@gatekeeper-os/'):
                check(dep in names and pin == version, name + ': internal pin mismatch: ' + dep)
                pins[dep] = pin
    receipt['packages'].append({'name': name, 'version': version, 'listing': path, 'exact': path + '/' + version, 'tarball': url, 'integrity': integrity, 'publishedAt': listing['time'][version], 'tags': tags, 'internalPins': pins})
print(json.dumps(receipt, indent=2))
