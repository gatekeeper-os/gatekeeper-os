/** Thin wrapper over the GitHub REST API. Every error passes through sanitizeError(); only numeric codes are logged. TODO(phase-4). */
export class GitHubApi { constructor(private token: string, private base = "https://api.github.com") {} }
