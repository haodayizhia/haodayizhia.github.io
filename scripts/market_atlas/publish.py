"""Publish an exact, non-forced local commit through GitHub's Git Database API.

Authentication comes from the existing Git credential manager, only in process memory.
Binary monthly data is stored uncompressed so Git can delta-compress daily changes.
"""
from pathlib import Path
from datetime import datetime, timezone, timedelta
import base64
import json
import os
import re
import subprocess
import urllib.request
import urllib.error


class Publisher:
    def __init__(self, repo):
        self.repo = Path(repo)
        remote = self.git('remote', 'get-url', 'origin').strip()
        match = re.fullmatch(r'https://github\.com/([\w.-]+)/([\w.-]+?)(?:\.git)?', remote)
        if not match:
            raise ValueError('Expected an HTTPS github.com origin.')
        self.api = f'https://api.github.com/repos/{match[1]}/{match[2]}'
        if self.git('branch', '--show-current').strip() != 'main':
            raise RuntimeError('Publication is limited to main; switch branches explicitly.')
        self.token = self.credential()

    def git(self, *args, binary=False):
        return subprocess.check_output(['git','-C',str(self.repo),*args], text=not binary, encoding=None if binary else 'utf-8', creationflags=subprocess.CREATE_NO_WINDOW if os.name=='nt' else 0)

    def credential(self):
        env = dict(os.environ, GIT_TERMINAL_PROMPT='0', GCM_INTERACTIVE='Never')
        native = Path(os.environ.get('ProgramFiles', 'C:/Program Files'))/'Git/mingw64/bin/git-credential-manager.exe'
        command = [str(native),'get'] if native.exists() else ['git','credential','fill']
        result = subprocess.run(command, input='protocol=https\nhost=github.com\n\n', capture_output=True, text=True, env=env, creationflags=subprocess.CREATE_NO_WINDOW if os.name=='nt' else 0)
        fields = dict(line.split('=',1) for line in result.stdout.splitlines() if '=' in line)
        if result.returncode or not fields.get('password'):
            raise RuntimeError('Saved GitHub authentication is unavailable. Sign into GitHub in Git Credential Manager, then rerun publication.')
        return fields['password']

    def call(self, method, path, body=None):
        payload = json.dumps(body,ensure_ascii=False).encode('utf-8') if body is not None else None
        request = urllib.request.Request(self.api+path, data=payload, method=method, headers={
            'Authorization':'Bearer '+self.token, 'Accept':'application/vnd.github+json',
            'Content-Type':'application/json', 'User-Agent':'BRO-MarketAtlas'})
        try:
            with urllib.request.urlopen(request, timeout=90) as response:
                return None if response.status==204 else json.load(response)
        except urllib.error.HTTPError as error:
            # Do not serialize request headers or credentials into logs.
            raise RuntimeError(f'GitHub returned HTTP {error.code} during {method} {path}.') from None

    def remote_head(self):
        return self.call('GET','/git/ref/heads/main')['object']['sha']

    def require_synced(self):
        if self.remote_head() != self.git('rev-parse','HEAD').strip():
            raise RuntimeError('Local main differs from GitHub. Synchronize it before publishing; no remote files were changed.')

    def publish_head(self, allowed):
        if self.git('status','--porcelain').strip():
            raise RuntimeError('The working tree changed after commit; publication stopped.')
        sha=self.git('rev-parse','HEAD').strip()
        raw=self.git('cat-file','commit',sha)
        headers,message=raw.split('\n\n',1)
        parents=re.findall(r'^parent ([a-f0-9]{40})$',headers,re.M)
        tree=re.search(r'^tree ([a-f0-9]{40})$',headers,re.M)[1]
        if len(parents)!=1 or '\ngpgsig ' in headers:
            raise RuntimeError('Expected one unsigned commit parent.')
        parent=parents[0]
        remote=self.remote_head()
        if remote==sha:
            self.git('update-ref','refs/remotes/origin/main',sha)
            return sha
        if remote!=parent:
            raise RuntimeError('Remote main advanced; stopped without overwriting it.')
        changed=self.git('diff-tree','--no-commit-id','--name-status','-r','-z',sha).split('\0')
        entries=[]
        for i in range(0,len(changed)-1,2):
            status,name=changed[i:i+2]
            if not allowed(name):
                raise RuntimeError('Unexpected publication file: '+name)
            if status=='D':
                entries.append(dict(path=name,mode='100644',type='blob',sha=None));continue
            if status not in ('A','M'):
                raise RuntimeError('Unsupported change type: '+status)
            content=self.git('show',f'{sha}:{name}',binary=True)
            if len(content)>90*1024**2:
                raise RuntimeError('Source chunk is too large: '+name)
            blob=self.call('POST','/git/blobs',dict(content=base64.b64encode(content).decode('ascii'),encoding='base64'))
            expected=self.git('rev-parse',f'{sha}:{name}').strip()
            if blob['sha']!=expected:
                raise RuntimeError('Uploaded blob mismatch; branch not changed.')
            entries.append(dict(path=name,mode='100644',type='blob',sha=blob['sha']))
        base=self.call('GET','/git/commits/'+parent)
        uploaded=self.call('POST','/git/trees',dict(base_tree=base['tree']['sha'],tree=entries))
        if uploaded['sha']!=tree:
            raise RuntimeError('Uploaded tree differs from tested local tree; branch not changed.')
        def identity(role):
            m=re.search(r'^'+role+r' (.*) <([^>]*)> (\d+) ([+-]\d{4})$',headers,re.M)
            zone=m[4];minutes=(int(zone[1:3])*60+int(zone[3:]))*(-1 if zone[0]=='-' else 1)
            date=datetime.fromtimestamp(int(m[3]),timezone(timedelta(minutes=minutes))).isoformat(timespec='seconds')
            return dict(name=m[1],email=m[2],date=date)
        uploaded=self.call('POST','/git/commits',dict(message=message,tree=tree,parents=[parent],author=identity('author'),committer=identity('committer')))
        if uploaded['sha']!=sha:
            raise RuntimeError('Commit identity mismatch; branch not changed.')
        if self.remote_head()!=parent:
            raise RuntimeError('Remote main advanced during publication; branch not changed.')
        updated=self.call('PATCH','/git/refs/heads/main',dict(sha=sha,force=False))
        if updated['object']['sha']!=sha:
            raise RuntimeError('Remote ref verification failed.')
        self.git('update-ref','refs/remotes/origin/main',sha)
        return sha
