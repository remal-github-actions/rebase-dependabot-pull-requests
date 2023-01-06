import * as core from '@actions/core'
import { context } from '@actions/github'
import { newOctokitInstance } from './internal/octokit'
import { IssueComment, IssueEvent, PullRequestSimple } from './internal/types'

/* * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * */

const githubToken = core.getInput('githubToken', { required: true })
const dryRun = core.getInput('dryRun', { required: true }).toLowerCase() === 'true'

const octokit = newOctokitInstance(githubToken)

const dependabotUsers = [
    'dependabot',
    'dependabot[bot]',
]

/* * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * */

async function run(): Promise<void> {
    try {
        const prs: PullRequestSimple[] = await core.group('Retrieving Dependabot open PRs', async () => {
            const allSimplePrs: PullRequestSimple[] = await octokit.paginate(octokit.pulls.list, {
                owner: context.repo.owner,
                repo: context.repo.repo,
                state: 'open',
            })
            const dependabotSimplePrs = allSimplePrs
                .filter(pr => pr.user != null && dependabotUsers.includes(pr.user.login))
                .filter(pr => !pr.locked)
            return dependabotSimplePrs
        })

        for (const pr of prs) {
            await core.group(`Processing "${pr.title}"`, async () => {
                const comparison = await octokit.repos.compareCommits({
                    owner: context.repo.owner,
                    repo: context.repo.repo,
                    base: pr.base.ref,
                    head: pr.head.sha,
                    per_page: 1,
                }).then(it => it.data)

                if (comparison.behind_by === 0) {
                    core.info('Up-to-date')
                    return
                } else {
                    core.info(`Behind by ${comparison.behind_by} commits`)
                }

                const prEvents = await octokit.paginate(octokit.issues.listEvents, {
                    owner: context.repo.owner,
                    repo: context.repo.repo,
                    issue_number: pr.number,
                })

                const prComments = await octokit.paginate(octokit.issues.listComments, {
                    owner: context.repo.owner,
                    repo: context.repo.repo,
                    issue_number: pr.number,
                })

                const prAllEvents: (IssueEvent | IssueComment)[] = [...prEvents, ...prComments]
                    .sort((o1, o2) => {
                        const createdAt1 = new Date(o1.created_at || '')
                        const createdAt2 = new Date(o2.created_at || '')
                        return -1 * (createdAt1.getTime() - createdAt2.getTime())
                    })
                core.info(JSON.stringify(prAllEvents, null, 2))
                for (const prEvent of prAllEvents) {
                    const login = (prEvent as IssueEvent).actor?.login || (prEvent as IssueComment).user?.login || ''
                    const event = (prEvent as IssueEvent).event || 'comment'
                    const comment = (prEvent as IssueComment).body || ''

                    if (dependabotUsers.includes(login) && event === 'head_ref_force_pushed') {
                        break
                    }

                    if (dependabotUsers.includes(login) && comment.match(/\b@dependabot recreate\b/)) {
                        core.warning(comment)
                        return
                    }
                }
            })
        }

        throw new Error('draft')

    } catch (error) {
        core.setFailed(error instanceof Error ? error : (error as object).toString())
        throw error
    }
}

//noinspection JSIgnoredPromiseFromCall
run()
