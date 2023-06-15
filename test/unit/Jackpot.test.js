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
          const accounts = await ethers.getSigners();
          await jackpot.enterJackpot({ value: minAmount });
          const jackpotPlayer1 = jackpot.connect(accounts[2]);
          await jackpotPlayer1.enterJackpot({ value: minAmount });
          await network.provider.send('evm_increaseTime', [gameTime.toNumber() + 1]);
          await network.provider.send('evm_mine', []);
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
        it('emits event JackpotEnter', async function () {
          await expect(jackpot.enterJackpot({ value: minAmount })).to.emit(jackpot, 'JackpotEnter');
        });
      });
      describe('checkUpkeep', function () {
        it('should be false if not open and not at least two players', async function () {
          const { upkeepNeeded: resultBefore } = await jackpot.callStatic.checkUpkeep([]);
          await jackpot.enterJackpot({ value: maxAmount });
          await network.provider.send('evm_increaseTime', [gameTime.toNumber() + 1]);
          await network.provider.send('evm_mine', []);
          const { upkeepNeeded: resultAfter } = await jackpot.callStatic.checkUpkeep([]);
          assert.equal(resultBefore, false);
          assert.equal(resultAfter, false);
        });
        it('should be false if not enough time passed', async function () {
          const accounts = await ethers.getSigners();
          await jackpot.enterJackpot({ value: minAmount });
          const jackpotPlayer1 = jackpot.connect(accounts[1]);
          await jackpotPlayer1.enterJackpot({ value: minAmount });
          await network.provider.send('evm_increaseTime', [gameTime.toNumber() - 5]);
          await network.provider.send('evm_mine', []);

          const { upkeepNeeded } = await jackpot.callStatic.checkUpkeep([]);
          assert.equal(upkeepNeeded, false);
        });
        it('should be false if the balance of the contract is too low', async function () {
          const accounts = await ethers.getSigners();
          await jackpot.enterJackpot({ value: minAmount });
          const jackpotPlayer1 = jackpot.connect(accounts[1]);
          expect(jackpotPlayer1.enterJackpot({ value: minAmount - 1 })).to.be.revertedWithCustomError(
            jackpot,
            'Jackpot_NotEnoughEthEntered'
          );

          await network.provider.send('evm_increaseTime', [gameTime.toNumber() + 1]);
          await network.provider.send('evm_mine', []);

          const { upkeepNeeded } = await jackpot.callStatic.checkUpkeep([]);
          assert.equal(upkeepNeeded, false);
        });
        it('should be true, if all tests passed', async function () {
          const accounts = await ethers.getSigners();
          await jackpot.enterJackpot({ value: minAmount });
          const jackpotPlayer1 = jackpot.connect(accounts[2]);
          await jackpotPlayer1.enterJackpot({ value: minAmount });
          await network.provider.send('evm_increaseTime', [gameTime.toNumber() + 1]);
          await network.provider.send('evm_mine', []);

          const { upkeepNeeded } = await jackpot.callStatic.checkUpkeep([]);
          assert.equal(upkeepNeeded, true);
        });
      });
      describe('performUpkeep', function () {
        describe('performUpkeep reverted', function () {
          it('reverts if upkeep not needed', async function () {
            await expect(jackpot.performUpkeep([])).to.be.revertedWithCustomError(jackpot, 'Jackpot_UpkeepNotNeeded');
          });
        });
        describe('performUpkeep successful', function () {
          this.beforeEach(async function () {
            const accounts = await ethers.getSigners();
            await jackpot.enterJackpot({ value: minAmount });
            const jackpotPlayer1 = jackpot.connect(accounts[2]);
            await jackpotPlayer1.enterJackpot({ value: minAmount });
            await network.provider.send('evm_increaseTime', [gameTime.toNumber() + 1]);
            await network.provider.send('evm_mine', []);
          });
          it('chainging game state to closed', async function () {
            await jackpot.performUpkeep([]);
            const gameState = await jackpot.getGameState();
            assert.equal(gameState.toString(), '2');
          });
          it('calls the vrf coordinator', async function () {
            const txResponse = await jackpot.performUpkeep([]);
            const txReceipt = await txResponse.wait(1);
            const requestId = await txReceipt.events[1].args.requestId;
            assert(requestId.toNumber() > 0);
          });
          it('emits event RequestedJackpotWinner', async function () {
            await expect(jackpot.performUpkeep([])).to.emit(jackpot, 'RequestedJackpotWinner');
          });
        });
      });
      describe('fulfillRandomWords', function () {
        this.beforeEach(async function () {
          const accounts = await ethers.getSigners();
          const jackpotPlayer1 = jackpot.connect(accounts[1]);
          await jackpotPlayer1.enterJackpot({ value: maxAmount });
          const jackpotPlayer2 = jackpot.connect(accounts[2]);
          await jackpotPlayer2.enterJackpot({ value: maxAmount });
          await network.provider.send('evm_increaseTime', [gameTime.toNumber() + 1]);
          await network.provider.send('evm_mine', []);
        });
        it('can only be called after requestRandomWords', async function () {
          await expect(vrfCoordinatorV2Mock.fulfillRandomWords(0, jackpot.address)).to.be.revertedWith(
            'nonexistent request'
          );
          await expect(vrfCoordinatorV2Mock.fulfillRandomWords(1, jackpot.address)).to.be.revertedWith(
            'nonexistent request'
          );
        });
        it('should have a valid request id', async function () {
          const tx = await jackpot.performUpkeep([]);
          const txReceipt = await tx.wait(1);
          assert(txReceipt.events[1].args.requestId > 0);
        });
        it('pick a winner, resets the jackpot', async function () {
          const accounts = await ethers.getSigners();
          const additionalEntrants = 6;
          const startingAccountIndex = 3;
          for (let i = startingAccountIndex; i < additionalEntrants; i++) {
            const connectedJackpot = jackpot.connect(accounts[i]);
            await connectedJackpot.enterJackpot({ value: maxAmount });
          }
          const startingTimeStamp = await jackpot.getGameStartTimeStamp();
          await new Promise(async (resolve, reject) => {
            jackpot.once('WinnerPicked', async (winner, rndNumber, indexOfWinningBalance, contractStartingBalance) => {
              console.log('Found the WinnerPickedEvent!');
              try {
                // const winner = await jackpot.getRecentWinner();

                console.log('Random Number: ', rndNumber.toString());
                console.log('Contract Balance: ', contractStartingBalance.toString());
                console.log('Index of Winning Balance: ', indexOfWinningBalance.toString());
                console.log('Recent Winner: ', winner);
                console.log('Players: ', accounts[1].address);
                console.log('Players: ', accounts[2].address);
                console.log('Players: ', accounts[3].address);
                console.log('Players: ', accounts[4].address);
                console.log('Players: ', accounts[5].address);
                console.log('Amount of players: ', numPlayersStart.toString());

                const gameState = await jackpot.getGameState();
                const endingTimeStamp = await jackpot.getGameStartTimeStamp();
                const numPlayersEnd = await jackpot.getPlayersAmount();
                const winnerEndingBalance = await ethers.provider.getBalance(winner);
                // const ownerEndingBalance = await ethers.provider.getBalance(accounts[0]);
                // const contractEndBalance = await ethers.provider.getBalance(jackpot.address);
                const winAmount = await jackpot.getRecentWinnerAmount();
                const winnerEntryAmount = await jackpot.getRecentWinnerEntry();

                assert.equal(gameState.toString(), '0');
                assert.equal(winnerEntryAmount.toString(), maxAmount.toString());
                assert(endingTimeStamp > startingTimeStamp);
                assert.equal(numPlayersEnd.toString(), '0');
                assert.equal(winnerEndingBalance.toString(), winnerStartingBalance.add(winAmount).toString());
                // assert.equal(contractStartingBalance.toString(), contractEndBalance.add(winAmount).toString());
                // assert.equal(ownerEndingBalance, ownerStartingBalance.add((contractStartingBalance.sub(winAmount))));
              } catch (e) {
                reject(e);
              }
              resolve();
            });
            const tx = await jackpot.performUpkeep([]);
            const txReceipt = await tx.wait(1);
            const numPlayersStart = await jackpot.getPlayersAmount();
            const winnerStartingBalance = await ethers.provider.getBalance(accounts[2].address);
            // const ownerStartingBalance = await ethers.provider.getBalance(accounts[0]);
            // const contractStartingBalance = await ethers.provider.getBalance(jackpot.address);
            await vrfCoordinatorV2Mock.fulfillRandomWords(txReceipt.events[1].args.requestId, jackpot.address);
          });
        });
        it('sends money to winner and owner', async function () {
          const accounts = await ethers.getSigners();
          const additionalEntrants = 6;
          const startingAccountIndex = 3;
          for (let i = startingAccountIndex; i < additionalEntrants; i++) {
            const connectedJackpot = jackpot.connect(accounts[i]);
            await connectedJackpot.enterJackpot({ value: maxAmount });
          }
          await new Promise(async (resolve, reject) => {
            jackpot.once('GameFeeTransfered', async (gameFee) => {
              console.log('Found the GameFeeTransfered Event!');
              try {
                const winner = await jackpot.getRecentWinner();

                console.log('Game Fee: ', gameFee.toString());
                console.log('Recent Winner: ', winner);
                console.log('Player 1: ', accounts[1].address);
                console.log('Player 2: ', accounts[2].address);
                console.log('Player 3: ', accounts[3].address);
                console.log('Player 4: ', accounts[4].address);
                console.log('Player 5: ', accounts[5].address);
                console.log('Amount of players: ', numPlayersStart.toString());

                const winnerEndingBalance = await ethers.provider.getBalance(winner);
                const ownerEndingBalance = await ethers.provider.getBalance(accounts[0].address);
                const contractEndBalance = await ethers.provider.getBalance(jackpot.address);
                const winAmount = await jackpot.getRecentWinnerAmount();

                assert.equal(winnerEndingBalance.toString(), winnerStartingBalance.add(winAmount).toString());
                assert.equal(
                  contractStartingBalance.toString(),
                  contractEndBalance.add(winAmount).add(gameFee).toString()
                );
                assert.equal(contractEndBalance.toString(), '0');
                assert.equal(ownerEndingBalance.toString(), ownerStartingBalance.add(gameFee).toString());
              } catch (e) {
                reject(e);
              }
              resolve();
            });
            const tx = await jackpot.performUpkeep([]);
            const txReceipt = await tx.wait(1);
            const numPlayersStart = await jackpot.getPlayersAmount();
            const winnerStartingBalance = await ethers.provider.getBalance(accounts[2].address);
            const ownerStartingBalance = await ethers.provider.getBalance(accounts[0].address);
            const contractStartingBalance = await ethers.provider.getBalance(jackpot.address);
            console.log('Accounts amount: ' + accounts.length);
            const vrfCoordinatorV2MockExtern = vrfCoordinatorV2Mock.connect(accounts[accounts.length - 1]);
            await vrfCoordinatorV2MockExtern.fulfillRandomWords(txReceipt.events[1].args.requestId, jackpot.address);
          });
        });
      });
    });
