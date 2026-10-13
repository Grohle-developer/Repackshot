// Where Repackshot looks for new versions: the GitHub repository whose published
// releases are the update feed (`GET /repos/<owner>/<repo>/releases/latest`, which
// leaves out drafts and pre-releases). To follow another repository, change this one
// line; nothing else knows the name. Data only (the request is in src/io/updates.ts).

export interface UpdateFeed {
  owner: string;
  repo: string;
}

export const UPDATE_FEED: UpdateFeed = { owner: 'Grohle-developer', repo: 'Repackshot' };
