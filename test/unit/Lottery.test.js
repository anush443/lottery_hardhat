const { getNamedAccounts, network, deployments, ethers } = require("hardhat")
const { developmentChains, networkConfig } = require("../../helper-hardhat-config")
const { assert, expect } = require("chai")

!developmentChains.includes(network.name)
    ? describe.skip
    : describe("Lottery", function () {
          let lottery, vrfCoordinatorV2Mock, chainId, entranceFee, deployer, interval
          chainId = network.config.chainId

          beforeEach(async function () {
              deployer = (await getNamedAccounts()).deployer

              await deployments.fixture(["all"])
              lottery = await ethers.getContract("Lottery", deployer)
              vrfCoordinatorV2Mock = await ethers.getContract("VRFCoordinatorV2Mock", deployer)
              entranceFee = await lottery.getEntranceFee()
              interval = await lottery.getInterval()
          })
          describe("constructor", function () {
              it("initializes the Lottery  correctly", async function () {
                  const lotteryState = await lottery.getLotteryState()
                  const interval = await lottery.getInterval()
                  assert.equal(lotteryState.toString(), "0")
                  assert.equal(interval.toString(), networkConfig[chainId]["interval"])
              })
          })

          describe("enterLottery", function () {
              it("it reverts when you dont pay enough", async function () {
                  await expect(lottery.enterLottery()).to.be.revertedWith(
                      "Lottery__NotEnoughEthEntered"
                  )
              })
              it("it records player when they enter", async function () {
                  await lottery.enterLottery({ value: entranceFee })
                  const playerFromContract = await lottery.getPlayer(0)
                  assert.equal(playerFromContract, deployer)
              })
              it("emits events on enter", async function () {
                  await expect(lottery.enterLottery({ value: entranceFee })).to.emit(
                      lottery,
                      "LotteryEnter"
                  )
              })
              it("doesnt allow entrance when lottery is calculating", async function () {
                  await lottery.enterLottery({ value: entranceFee })
                  await network.provider.send("evm_increaseTime", [interval.toNumber() + 1])
                  await network.provider.send("evm_mine", [])
                  //pretend to be a chainlink keeper

                  await lottery.performUpkeep([])
                  await expect(lottery.enterLottery({ value: entranceFee })).to.be.revertedWith(
                      "Lottery__NotOpen"
                  )
              })
          })
          describe("checkUpKeep", function () {
              it("should return false if people havent sent any ETH", async function () {
                  await network.provider.send("evm_increaseTime", [interval.toNumber() + 1])
                  await network.provider.send("evm_mine", [])
                  const { upkeepNeeded } = await lottery.callStatic.checkUpkeep([])
                  assert(!upkeepNeeded)
              })

              it("should return false if lottery isnt open", async function () {
                  await lottery.enterLottery({ value: entranceFee })
                  await network.provider.send("evm_increaseTime", [interval.toNumber() + 1])
                  await network.provider.send("evm_mine", [])
                  await lottery.performUpkeep([])
                  const lotteryState = await lottery.getLotteryState()
                  const { upkeepNeeded } = await lottery.callStatic.checkUpkeep([])
                  assert.equal(lotteryState.toString(), "1")
                  assert.equal(upkeepNeeded, false)
              })

              it("should return false if enough time hasnt passed", async function () {
                  await lottery.enterLottery({ value: entranceFee })
                  await network.provider.send("evm_increaseTime", [interval.toNumber() - 1])
                  await network.provider.send("evm_mine", [])
                  await lottery.performUpkeep([])
                  const { upkeepNeeded } = await lottery.callStatic.checkUpkeep([])
                  assert(!upkeepNeeded)
              })

              it("should return true if enough time has passed, has players, eth, and is open", async function () {
                  await lottery.enterLottery({ value: entranceFee })
                  await network.provider.send("evm_increaseTime", [interval.toNumber() + 1])
                  await network.provider.send("evm_mine", [])
                  const { upkeepNeeded } = await lottery.callStatic.checkUpkeep([])
                  assert(upkeepNeeded)
              })
          })

          describe("performUpkeep", function () {
              it("it can only run if checkupkeep is true", async function () {
                  await lottery.enterLottery({ value: entranceFee })
                  await network.provider.send("evm_increaseTime", [interval.toNumber() + 1])
                  await network.provider.send("evm_mine", [])
                  const tx = await lottery.performUpkeep([])
                  assert(tx)
              })
              it("reverts if checkup is false", async () => {
                  await expect(lottery.performUpkeep([])).to.be.revertedWith(
                      "Lottery_UpkeepNotNeeded"
                  )
              })

              it("updates lottery state,emits an event and call the vrf coordinatore", async function () {
                  await lottery.enterLottery({ value: entranceFee })
                  await network.provider.send("evm_increaseTime", [interval.toNumber() + 1])
                  await network.provider.send("evm_mine", [])
                  const txResponse = await lottery.performUpkeep([])
                  const txReceipt = await txResponse.wait(1)
                  const requestId = txReceipt.events[1].args.requestId
                  const lotteryState = await lottery.getLotteryState()
                  assert(requestId.toNumber() > 0)
                  assert(lotteryState === 1)
              })
          })
          describe("fulfillRandomWords", function () {
              beforeEach(async function () {
                  await lottery.enterLottery({ value: entranceFee })
                  await network.provider.send("evm_increaseTime", [interval.toNumber() + 1])
                  await network.provider.request({ method: "evm_mine", params: [] })
              })
              it("can only be called after performupkeep", async () => {
                  await expect(
                      vrfCoordinatorV2Mock.fulfillRandomWords(0, lottery.address) // reverts if not fulfilled
                  ).to.be.revertedWith("nonexistent request")
                  await expect(
                      vrfCoordinatorV2Mock.fulfillRandomWords(1, lottery.address) // reverts if not fulfilled
                  ).to.be.revertedWith("nonexistent request")
              })
              it("picks a winner,resets, and sends money", async () => {
                  const additionalEntrances = 3 // to test
                  const startingIndex = 2
                  const accounts = await ethers.getSigners()
                  for (i = startingIndex; i < startingIndex + additionalEntrances; i++) {
                      const accountConnectedLottery = lottery.connect(accounts[i])
                      await accountConnectedLottery.enterLottery({ value: entranceFee })
                  }
                  const startingTimeStamp = await lottery.getLatestTimeStamp()
                  await new Promise(async function (resolve, reject) {
                      lottery.once("WinnerPicked", async function () {
                          console.log("Found the event")
                          try {
                              const recentWinner = await lottery.getRecentWinner()
                              const lotteryState = await lottery.getLotteryState()
                              const endingTimeStamp = await lottery.getLatestTimeStamp()
                              const numPlayers = await lottery.getNumberofPlayers()
                              const winnerEndingBalance = await accounts[1].getBalance()
                              assert.equal(numPlayers.toString(), "0")
                              assert.equal(lotteryState.toString(), "0")
                              assert(endingTimeStamp > startingTimeStamp)
                              assert.equal(
                                  winnerEndingBalance.toString(),
                                  winnerStartingBalance.add(
                                      entranceFee
                                          .mul(additionalEntrances)
                                          .add(entranceFee)
                                          .toString()
                                  )
                              )
                              resolve()
                          } catch (e) {
                              reject(e)
                          }
                      })

                      const tx = await lottery.performUpkeep([])
                      const txReceipt = await tx.wait(1)
                      const requestId = txReceipt.events[1].args.requestId
                      const winnerStartingBalance = await accounts[1].getBalance()
                      await vrfCoordinatorV2Mock.fulfillRandomWords(requestId, lottery.address)
                  })
              })
          })
      })
