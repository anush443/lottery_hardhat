const { ethers, network } = require("hardhat")
const fs = require("fs")

const frontEndContractsFile = "../smart-lottery-dapp/constants/contractAddresses.json"
const frontEndAbiFile = "../smart-lottery-dapp/constants/abi.json"

module.exports = async () => {
    if (process.env.UPDATE_FRONT_END) {
        console.log("WRITING TO FRONTEND")
        updateContractAddresses()
        updateAbi()
    }
}

const updateContractAddresses = async () => {
    const lottery = await ethers.getContract("Lottery")
    const contractAddresses = JSON.parse(fs.readFileSync(frontEndContractsFile, "utf8"))
    const chainId = network.config.chainId.toString()
    if (chainId in contractAddresses) {
        if (!contractAddresses[chainId].includes(lottery.address)) {
            contractAddresses[chainId].push(lottery.address)
        }
    } else {
        contractAddresses[chainId] = [lottery.address]
    }
    fs.writeFileSync(frontEndContractsFile, JSON.stringify(contractAddresses))
}

const updateAbi = async () => {
    const lottery = await ethers.getContract("Lottery")
    fs.writeFileSync(frontEndAbiFile, lottery.interface.format(ethers.utils.FormatTypes.json))
}

module.exports.tags = ["all", "frontend"]
