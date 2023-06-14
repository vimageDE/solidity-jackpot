const { network, ethers } = require('hardhat');
const { verify } = require('../Utils/verify');
const { networkConfig } = require('../helper-hardhat-config');
const VRF_SUB_FUND_AMOUNT = ethers.utils.parseEther('30');

module.exports = async function ({ deployments }) {
  return;
  const { deploy, log } = deployments;
  const [deployer] = await ethers.getSigners();
  let vrfCoordinatorV2Address, subscriptionId;
  const localChain = network.config.local;
  const chainId = network.config.chainId;
  const waitBlockConfirmations = network.config.blockConfirmations || 1;

  if (localChain) {
    // Deploy Mock
    const vrfCoordinatorV2Mock = await ethers.getContract('VRFCoordinatorV2Mock');
    vrfCoordinatorV2Address = vrfCoordinatorV2Mock.address;
    const txResponse = await vrfCoordinatorV2Mock.createSubscription();
    const txReceipt = await txResponse.wait(1);
    subscriptionId = txReceipt.events[0].args.subId;
    await vrfCoordinatorV2Mock.fundSubscription(subscriptionId, VRF_SUB_FUND_AMOUNT);
  } else {
    vrfCoordinatorV2Address = network.config.vrfCoordinatorV2;
    subscriptionId = network.config.subscriptionId;
  }

  const entranceFee_min = networkConfig[chainId]['jackpotEntranceFee_min'];
  const entranceFee_max = networkConfig[chainId]['jackpotEntranceFee_max'];
  const winRate = networkConfig[chainId]['jackPotWinRate'];
  const gameTime = networkConfig[chainId]['keepersUpdateInterval'];

  const args = [vrfCoordinatorV2Address, entranceFee_min, entranceFee_max, winRate, gameTime];
  const jackpot = await deploy('Jackpot', {
    from: deployer.address,
    args: args,
    log: true,
    waitConfirmations: waitBlockConfirmations,
  });

  // Ensure the Jackpot contract is a valid consumer of the VRFCoordinatorV2Mock contract.
  if (localChain) {
    const vrfCoordinatorV2Mock = await ethers.getContract('VRFCoordinatorV2Mock');
    await vrfCoordinatorV2Mock.addConsumer(subscriptionId, jackpot.address);
  }

  if (!localChain && process.env.ETHERSCAN_TOKEN) {
    log('Verifying...');
    await verify(raffle.address, args);
  }
  log('------------------------------');
};

module.exports.tags = ['all', 'raffle'];
