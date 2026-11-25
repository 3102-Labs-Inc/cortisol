// Minimal GitHub REST client for the admin panel. The token lives only in this object, in memory;
// it is sent only to the configured API base (https://api.github.com in production).
(function (root) {
  'use strict';
  const isNode = typeof module !== 'undefined' && module.exports;
  const core = isNode ? require('../report-core.js') : root.TraceReportCore;
  const utf8 = { encode: s => new TextEncoder().encode(s), decode: b => new TextDecoder().decode(b) };
  const repoPattern = /^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/, pathPattern = /^[A-Za-z0-9._\/-]+$/;
  class GitHubError extends Error { constructor(message, status) { super(message); this.status = status; } }

  function client({ token, apiBase = 'https://api.github.com', fetchImpl } = {}) {
    if (typeof token !== 'string' || !/^[A-Za-z0-9_]{20,255}$/.test(token.trim())) throw new GitHubError('Paste a GitHub personal access token (it starts with github_pat_ or ghp_).', 0);
    const secret = token.trim(), doFetch = fetchImpl || root.fetch.bind(root);
    async function call(method, path, body) {
      let res;
      try {
        res = await doFetch(apiBase + path, { method, headers: { Accept: 'application/vnd.github+json', Authorization: 'Bearer ' + secret, 'X-GitHub-Api-Version': '2022-11-28', ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined, cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer' });
      } catch (_) { throw new GitHubError('Could not reach GitHub. Check the internet connection and try again.', 0); }
      if (res.status === 401) throw new GitHubError('GitHub did not accept this token. It may be mistyped, expired or revoked.', 401);
      if (res.status === 403 && res.headers.get('x-ratelimit-remaining') === '0') throw new GitHubError('GitHub’s request limit was reached. Wait a few minutes and try again.', 403);
      return res;
    }
    const checkRepo = repo => { if (!repoPattern.test(repo)) throw new GitHubError('Invalid repository name.', 0); return repo; };
    const checkPath = p => { if (!pathPattern.test(p) || p.split('/').some(s => s === '..' || s === '')) throw new GitHubError('Invalid file path.', 0); return p; };
    return {
      async user() {
        const res = await call('GET', '/user');
        if (!res.ok) throw new GitHubError('GitHub could not confirm who this token belongs to.', res.status);
        const u = await res.json();
        return { login: u.login, name: u.name || u.login };
      },
      // Access check: the records repository must be private and this token must be able to write to it.
      async repo(repo) {
        const res = await call('GET', '/repos/' + checkRepo(repo));
        if (res.status === 404 || res.status === 403) throw new GitHubError('This token cannot see the records repository ' + repo + '. Ask an admin to add you, and give the token access to that repository.', res.status);
        if (!res.ok) throw new GitHubError('GitHub returned an error while checking ' + repo + '.', res.status);
        const r = await res.json();
        if (!r.private) throw new GitHubError('The records repository ' + repo + ' is not private. Stop and make it private before using the panel.', 0);
        if (!r.permissions || !r.permissions.push) throw new GitHubError('This token can read but not write to ' + repo + '. Give it “Contents: read and write” access.', 0);
        return { fullName: r.full_name, private: r.private, defaultBranch: r.default_branch };
      },
      // Returns {text, sha} or null when the file does not exist.
      async getFile(repo, path, branch) {
        const res = await call('GET', '/repos/' + checkRepo(repo) + '/contents/' + checkPath(path) + (branch ? '?ref=' + encodeURIComponent(branch) : ''));
        if (res.status === 404) return null;
        if (res.status === 403) throw new GitHubError('This token is not allowed to read ' + repo + '.', res.status);
        if (!res.ok) throw new GitHubError('Could not read ' + path + ' from ' + repo + '.', res.status);
        const f = await res.json();
        if (f.type !== 'file' || f.encoding !== 'base64') throw new GitHubError(path + ' is not a readable file.', 0);
        return { text: utf8.decode(core.fromBase64(f.content.replace(/\s/g, ''))), sha: f.sha };
      },
      // Creates or updates a file as one commit by the signed-in user. sha is required to update.
      async putFile(repo, path, text, message, sha, branch) {
        const res = await call('PUT', '/repos/' + checkRepo(repo) + '/contents/' + checkPath(path), { message, content: core.toBase64(utf8.encode(text)), ...(sha ? { sha } : {}), ...(branch ? { branch } : {}) });
        if (res.status === 409 || res.status === 422) throw new GitHubError('Someone else changed ' + path + ' at the same time. Reload and try again.', res.status);
        if (res.status === 403 || res.status === 404) throw new GitHubError('This token is not allowed to write to ' + repo + '. Give it “Contents: read and write” access to that repository.', res.status);
        if (!res.ok) throw new GitHubError('Could not save ' + path + ' to ' + repo + '.', res.status);
        const out = await res.json();
        return { sha: out.content && out.content.sha, commit: out.commit && out.commit.sha };
      }
    };
  }
  const api = Object.freeze({ client, GitHubError });
  root.TraceGitHub = api;
  if (isNode) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
