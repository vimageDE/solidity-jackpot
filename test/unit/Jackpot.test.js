const { network, ethers, deployments } = require('hardhat');
const { assert, expect } = require('chai');
const { equal } = require('assert');
const { describe } = require('node:test');
const { networkConfig } = require('../helper-hardhat-config');

!network.config.local
  ? describe.skip
  : describe('Jackput Unit Test', function () {
      let jackpot, vrfCoordinatorV2Mock, jackpotEntrance_min, jackpotEntrance_max, gameTime;
      let deployer;
      this.beforeEach(async function () {
        [deployer] = await ethers.getSigners();
        await deployments.fixture('all');
        jackpot = await deployments.getContract('Jackpot', deployer);
        vrfCoordinatorV2Mock = await deployments.getContract('VRFCoordinatorV2Mock', deployer);
        jackpotEntrance_min = await jackpot.getEntranceFeeMin();
        jackpotEntrance_max = await jackpot.getEntranceFeeMax();
        jackpotWinRate = await jackpot.getWinRate();
        gameTime = await jackpot.getGameTime();
      });

      describe('constructor', function () {
        it('Check if Owner is set correctly', async function () {
          const owner = await jackpot.getOwner();

          assert.equal(owner, deployer.address);
        });
        it('Initializes the jackpot correctly', async function () {
          const jackpotState = await jackpot.getGameState();

          assert.equal(jackpotState.toString(), '0');
          assert.equal(gameTime.toString(), networkConfig[chainId]['keepersUpdateInterval']);
          assert.equal(jackpotEntrance_min, networkConfig[chainId]['jackpotEntranceFee_min']);
          assert.equal(jackpotEntrance_max, networkConfig[chainId]['jackpotEntranceFee_max']);
          assert.equal(jackpotWinRate, networkConfig[chainId]['jackPotWinRate']);
        });
      });
    });
