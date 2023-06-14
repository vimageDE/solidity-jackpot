const { network, ethers, deployments } = require('hardhat');
const { assert, expect } = require('chai');
const { equal } = require('assert');
const { networkConfig } = require('../../helper-hardhat-config');

!network.config.local
  ? describe.skip
  : describe('Jackput Unit Test', function () {
      let jackpot, vrfCoordinatorV2Mock, jackpotEntrance_min, jackpotEntrance_max, gameTime;
      let deployer, chainId, minAmount, maxAmount;

      this.beforeEach(async function () {
        [deployer] = await ethers.getSigners();
        await deployments.fixture('all');
        jackpot = await ethers.getContract('Jackpot', deployer);
        vrfCoordinatorV2Mock = await ethers.getContract('VRFCoordinatorV2Mock', deployer);
        jackpotEntrance_min = await jackpot.getEntranceFeeMin();
        jackpotEntrance_max = await jackpot.getEntranceFeeMax();
        jackpotWinRate = await jackpot.getWinRate();
        gameTime = await jackpot.getGameTime();
        // get network variables
        chainId = network.config.chainId;
        minAmount = networkConfig[chainId]['jackpotEntranceFee_min'];
        maxAmount = networkConfig[chainId]['jackpotEntranceFee_max'];
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
          assert.equal(jackpotEntrance_min, networkConfig[chainId]['jackpotEntranceFee_min'].toString());
          assert.equal(jackpotEntrance_max, networkConfig[chainId]['jackpotEntranceFee_max'].toString());
          assert.equal(jackpotWinRate, networkConfig[chainId]['jackPotWinRate']);
        });
      });
      describe('enterJackpot', function () {
        // Check Reverts
        it('reverts if payment is too small', async function () {
          await expect(jackpot.enterJackpot({ value: 0 })).to.be.revertedWithCustomError(
            jackpot,
            'Jackpot_NotEnoughEthEntered'
          );
        });
        it('reverts if payment is too big', async function () {
          await expect(jackpot.enterJackpot({ value: maxAmount.mul(2) })).to.be.revertedWithCustomError(
            jackpot,
            'Jackpot_TooMuchEthEntered'
          );
        });
        it('reverts if player has previously entered and has now too much eth', async function () {
          await jackpot.enterJackpot({ value: minAmount });
          const amountFirstPayment = await jackpot.getAddressToAmount(deployer.address);
          assert.equal(amountFirstPayment, minAmount.toString());
          await expect(jackpot.enterJackpot({ value: maxAmount })).to.be.revertedWithCustomError(
            jackpot,
            'Jackpot_TooMuchEthEntered'
          );
        });
        it('reverts if the game state is calculating', async function () {
          await jackpot.performUpkeep([]);
          const gameState = await jackpot.getGameState();
          assert.equal(gameState, '2');
          await expect(jackpot.enterJackpot({ value: minAmount })).to.be.revertedWithCustomError(
            jackpot,
            'Jackpot_NotOpen'
          );
        });
        // Player enters Jackpot
        it('check player array size', async function () {
          const playerSizeBefore = await jackpot.getPlayersAmount();
          await jackpot.enterJackpot({ value: minAmount });
          const playerSizeAfter = await jackpot.getPlayersAmount();
          assert.equal(playerSizeBefore, 0);
          assert.equal(playerSizeAfter, 1);
        });
        it('check if the player is in the players array', async function () {
          await jackpot.enterJackpot({ value: minAmount });
          const playerAtIndexZero = await jackpot.getPlayerAtIndex(0);
          assert.equal(playerAtIndexZero, deployer.address);
        });
        it('amount of address should be the same as the send amount', async function () {
          await jackpot.enterJackpot({ value: maxAmount });
          const playerAmount = await jackpot.getAddressToAmount(deployer.address);
          assert.equal(playerAmount, maxAmount.toString());
        });
        it('gameState should change to open, if two players entered', async function () {
          const accounts = await ethers.getSigners();

          await jackpot.enterJackpot({ value: maxAmount });
          const gameStatePrevious = await jackpot.getGameState();
          const player1Connected = jackpot.connect(accounts[1]);
          await player1Connected.enterJackpot({ value: minAmount });
          const gameStateAfter = await jackpot.getGameState();
          assert.equal(gameStatePrevious.toString(), '0');
          assert.equal(gameStateAfter.toString(), '1');
        });
        it('gameState should not change, if the same users enters a second time', async function () {
          await jackpot.enterJackpot({ value: minAmount });
          const gameStatePrevious = await jackpot.getGameState();
          await jackpot.enterJackpot({ value: minAmount });
          const gameStateAfter = await jackpot.getGameState();
          assert.equal(gameStatePrevious.toString(), '0');
          assert.equal(gameStateAfter.toString(), '0');
        });
      });
    });
