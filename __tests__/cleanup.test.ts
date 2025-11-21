import { jest } from '@jest/globals'

const inputs = new Map<string, string>()

const getInputMock = jest.fn((name: string) => {
    return inputs.get(name) || ''
})
const setFailedMock = jest.fn()
const setOutputMock = jest.fn()
const infoMock = jest.fn()
const debugMock = jest.fn()

const graphqlMock = jest.fn()
const getOctokitMock = jest.fn(() => ({
    graphql: graphqlMock
}))

async function loadCleanup() {
    jest.resetModules()

    jest.unstable_mockModule('@actions/core', () => ({
        getInput: getInputMock,
        setFailed: setFailedMock,
        setOutput: setOutputMock,
        info: infoMock,
        debug: debugMock
    }))

    jest.unstable_mockModule('@actions/github', () => ({
        getOctokit: getOctokitMock
    }))

    jest.unstable_mockModule('../src/github.js', () => ({
        parseTargetRepo: (input: string) => {
            const [owner, repo] = (input || 'owner/repo').split('/')
            return { owner, repo }
        }
    }))

    jest.unstable_mockModule('@octokit/graphql', () => ({
        graphql: {
            defaults: jest.fn(() => graphqlMock)
        }
    }))

    return import('../src/cleanup.js')
}

describe('cleanup action', () => {
    beforeEach(() => {
        jest.clearAllMocks()
        inputs.clear()

        // Default inputs
        inputs.set('github-token', 'fake-token')
        inputs.set('target-repo', 'owner/repo')
        inputs.set('discussion-category-name', 'Announcements')
        inputs.set('expiration-hours', '168')
        inputs.set('discussion-title-template', 'SWA access invites for {swaName} ({repo}) - {date}')
    })

    test('should delete expired discussions', async () => {
        // GraphQLレスポンスのモック
        graphqlMock
            .mockResolvedValueOnce({
                repository: {
                    discussionCategories: {
                        nodes: [{ id: 'cat1', name: 'Announcements' }]
                    }
                }
            })
            .mockResolvedValueOnce({
                repository: {
                    discussions: {
                        nodes: [
                            {
                                id: 'disc1',
                                title: 'SWA access invites for my-app (owner/repo) - 2023-01-01',
                                createdAt: '2023-01-01T00:00:00Z', // 期限切れ
                                url: 'https://github.com/owner/repo/discussions/1'
                            },
                            {
                                id: 'disc2',
                                title: 'SWA access invites for my-app (owner/repo) - 2099-01-01',
                                createdAt: '2099-01-01T00:00:00Z', // 未来（期限切れでない）
                                url: 'https://github.com/owner/repo/discussions/2'
                            },
                            {
                                id: 'disc3',
                                title: 'Other discussion',
                                createdAt: '2023-01-01T00:00:00Z', // タイトル不一致
                                url: 'https://github.com/owner/repo/discussions/3'
                            }
                        ]
                    }
                }
            })
            .mockResolvedValueOnce({
                deleteDiscussion: { clientMutationId: null }
            })

        const { run } = await loadCleanup()
        await run()

        // 検証
        expect(setFailedMock).not.toHaveBeenCalled()
        expect(infoMock).toHaveBeenCalledWith(expect.stringContaining('Found category ID: cat1'))
        expect(infoMock).toHaveBeenCalledWith(expect.stringContaining('Deleting expired discussion'))
        expect(setOutputMock).toHaveBeenCalledWith('deleted-count', 1)

        // 削除mutationが1回だけ呼ばれたことを確認
        // 3回目のgraphql呼び出しが削除
        expect(graphqlMock).toHaveBeenCalledTimes(3)
    })

    test('should fail if category not found', async () => {
        inputs.set('discussion-category-name', 'MissingCategory')

        graphqlMock.mockResolvedValueOnce({
            repository: {
                discussionCategories: {
                    nodes: [{ id: 'cat1', name: 'ExistingCategory' }]
                }
            }
        })

        const { run } = await loadCleanup()
        await run()

        expect(setFailedMock).toHaveBeenCalledWith(expect.stringContaining('Category "MissingCategory" not found'))
    })

    test('should delete all discussions if cleanup-mode is immediate', async () => {
        inputs.set('cleanup-mode', 'immediate')

        graphqlMock
            .mockResolvedValueOnce({
                repository: {
                    discussionCategories: {
                        nodes: [{ id: 'cat1', name: 'Announcements' }]
                    }
                }
            })
            .mockResolvedValueOnce({
                repository: {
                    discussions: {
                        nodes: [
                            {
                                id: 'disc1',
                                title: 'SWA access invites for my-app (owner/repo) - 2099-01-01',
                                createdAt: '2099-01-01T00:00:00Z', // 未来（期限切れでない）
                                url: 'https://github.com/owner/repo/discussions/1'
                            }
                        ]
                    }
                }
            })
            .mockResolvedValueOnce({
                deleteDiscussion: { clientMutationId: null }
            })

        const { run } = await loadCleanup()
        await run()

        expect(infoMock).toHaveBeenCalledWith(expect.stringContaining('Deleting expired discussion'))
        expect(setOutputMock).toHaveBeenCalledWith('deleted-count', 1)
        expect(graphqlMock).toHaveBeenCalledTimes(3)
    })
})
