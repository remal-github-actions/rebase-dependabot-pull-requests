import * as core from '@actions/core'
import { context } from '@actions/github'
import { newOctokitInstance } from './internal/octokit'
import { PullRequest, PullRequestSimple } from './internal/types'

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
        const prs: PullRequest[] = await core.group('Retrieving Dependabot open PRs', async () => {
            const allSimplePrs: PullRequestSimple[] = await octokit.paginate(octokit.pulls.list, {
                owner: context.repo.owner,
                repo: context.repo.repo,
                state: 'open',
            })
            const dependabotSimplePrs = allSimplePrs
                .filter(pr => pr.user != null && dependabotUsers.includes(pr.user.login))
                .filter(pr => !pr.locked)

            const dependabotPrs: PullRequest[] = []
            for (const pr of dependabotSimplePrs) {
                const fullPr: PullRequest = await octokit.pulls.get({
                    owner: context.repo.owner,
                    repo: context.repo.repo,
                    pull_number: pr.number,
                }).then(it => it.data)
                dependabotPrs.push(fullPr)
            }
            const dependabotRebaseablePrs: PullRequest[] = []
            dependabotPrs.forEach(pr => {
                if (pr.rebaseable) {
                    dependabotRebaseablePrs.push(pr)
                    core.info(pr.html_url)
                } else {
                    core.info(`${pr.html_url} - not rebaseable`)
                }
            })
            return dependabotRebaseablePrs
        })

        for (const pr of prs) {
            await core.group(`Processing ${pr.title}`, async () => {
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
                

            })
        }

    } catch (error) {
        core.setFailed(error instanceof Error ? error : (error as object).toString())
        throw error
    }
}

//noinspection JSIgnoredPromiseFromCall
run()
