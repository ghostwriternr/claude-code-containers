// Handle repository changes (repos added/removed from installation)
// Type definitions
interface InstallationRepositoriesEventData {
  action: 'added' | 'removed';
  repositories_added?: Array<{
    id: number;
    name: string;
    full_name: string;
    private: boolean;
  }>;
  repositories_removed?: Array<{
    id: number;
    name: string;
    full_name: string;
    private: boolean;
  }>;
  installation: {
    id: number;
    app_id: number;
  };
}

interface GitHubAppConfigDO {
  fetch(request: Request): Promise<Response>;
}

export async function handleInstallationRepositoriesEvent(
  data: InstallationRepositoriesEventData, 
  configDO: GitHubAppConfigDO
): Promise<Response> {
  const action = data.action;

  if (action === 'added') {
    const addedRepos = data.repositories_added || [];
    for (const repo of addedRepos) {
      await configDO.fetch(new Request('http://internal/add-repository', {
        method: 'POST',
        body: JSON.stringify({
          id: repo.id,
          name: repo.name,
          full_name: repo.full_name,
          private: repo.private
        })
      }));
    }
    console.log(`Added ${addedRepos.length} repositories`);
  } else if (action === 'removed') {
    const removedRepos = data.repositories_removed || [];
    for (const repo of removedRepos) {
      await configDO.fetch(new Request(`http://internal/remove-repository/${repo.id}`, {
        method: 'DELETE'
      }));
    }
    console.log(`Removed ${removedRepos.length} repositories`);
  }

  return new Response('Repository changes processed', { status: 200 });
}