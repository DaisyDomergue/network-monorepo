function toNumber(value) {
    return (value !== undefined) ? Number(value) : undefined
}

/**
 * Streamr client constructor options that work in the test environment
 */
module.exports = {
    // ganache 1: 0x4178baBE9E5148c6D5fd431cD72884B07Ad855a0
    auth: {
        privateKey: process.env.ETHEREUM_PRIVATE_KEY || '0xe5af7834455b7239881b85be89d905d6881dcb4751063897f12be1b0dd546bdb',
    },
    url: process.env.WEBSOCKET_URL || `ws://${process.env.STREAMR_DOCKER_DEV_HOST || 'localhost'}/api/v1/ws`,
    restUrl: process.env.REST_URL || `http://${process.env.STREAMR_DOCKER_DEV_HOST || 'localhost'}/api/v1`,
    streamrNodeAddress: '0xFCAd0B19bB29D4674531d6f115237E16AfCE377c',
    tokenAddress: process.env.TOKEN_ADDRESS || '0xbAA81A0179015bE47Ad439566374F2Bae098686F',
    tokenSidechainAddress: process.env.TOKEN_ADDRESS_SIDECHAIN || '0x73Be21733CC5D08e1a14Ea9a399fb27DB3BEf8fF',
    withdrawServerUrl: process.env.WITHDRAW_SERVER_URL || 'http://localhost:3000',
    binanceAdapterAddress: process.env.BINANCE_ADAPTER || '0xdc5F6368cd31330adC259386e78604a5E29E9415',
    dataUnion: {
        factoryMainnetAddress: process.env.DU_FACTORY_MAINNET || '0x4bbcBeFBEC587f6C4AF9AF9B48847caEa1Fe81dA',
        factorySidechainAddress: process.env.DU_FACTORY_SIDECHAIN || '0x4A4c4759eb3b7ABee079f832850cD3D0dC48D927',
        templateMainnetAddress: process.env.DU_TEMPLATE_MAINNET || '0x7bFBAe10AE5b5eF45e2aC396E0E605F6658eF3Bc',
        templateSidechainAddress: process.env.DU_TEMPLATE_SIDECHAIN || '0x36afc8c9283CC866b8EB6a61C6e6862a83cd6ee8',
    },
    storageNode: {
        address: '0xde1112f631486CfC759A50196853011528bC5FA0',
        url: `http://${process.env.STREAMR_DOCKER_DEV_HOST || '10.200.10.1'}:8891`
    },
    network: {
        trackers: [
            'ws://127.0.0.1:30301',
            'ws://127.0.0.1:30302',
            'ws://127.0.0.1:30303'
        ],
    },
    nodeRegistry: {
        contractAddress: '0xbAA81A0179015bE47Ad439566374F2Bae098686F',
        jsonRpcProvider: `http://${process.env.STREAMR_DOCKER_DEV_HOST || '10.200.10.1'}:8546`,
    },
    sidechain: {
        url: process.env.SIDECHAIN_URL || `http://${process.env.STREAMR_DOCKER_DEV_HOST || '10.200.10.1'}:8546`,
        timeout: toNumber(process.env.TEST_TIMEOUT),
    },
    mainnet: {
        url: process.env.ETHEREUM_SERVER_URL || `http://${process.env.STREAMR_DOCKER_DEV_HOST || '10.200.10.1'}:8545`,
        timeout: toNumber(process.env.TEST_TIMEOUT),
    },
    autoConnect: false,
    autoDisconnect: false,
}
