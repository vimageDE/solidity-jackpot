const { network, ethers, deployments } = require('hardhat');
const { assert, expect } = require('chai');
const { equal } = require('assert');

network.config.local
  ? describe.skip
  : describe('Jackpot Staging Test', function () {
      this.beforeEach(async function () {
        [deployer] = await ethers.getSigners();
        jackpot = await ethers.getContract('Jackpot', deployer);
        jackpotEntrance_min = await jackpot.getEntranceFeeMin();
      });
      describe('fulfillRandomWords', function () {
        it('sends money to winner and owner', async function () {
          const accounts = await ethers.getSigners();
          let playersStartingBalance = {};
          console.log('Starting Stage Test!');

          await new Promise(async (resolve, reject) => {
            jackpot.once('GameFeeTransfered', async (gameFee) => {
              console.log('Found the GameFeeTransfered Event!');
              try {
                const winner = await jackpot.getRecentWinner();

                console.log('Game Fee: ', gameFee.toString());
                console.log('Recent Winner: ', winner);
                console.log('Player 1: ', accounts[1].address);
                console.log('Player 2: ', accounts[2].address);
                // console.log('Player 3: ', accounts[3].address);

                const winnerEndingBalance = await ethers.provider.getBalance(winner);
                const ownerEndingBalance = await ethers.provider.getBalance(accounts[0].address);
                const contractEndBalance = await ethers.provider.getBalance(jackpot.address);
                const winAmount = await jackpot.getRecentWinnerAmount();

                assert.equal(winnerEndingBalance.toString(), playersStartingBalance[winner].add(winAmount).toString());
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
            console.log('Subscribed to: GameFeeTransfered Event!');
            const accounts = await ethers.getSigners();
            const ownerStartingBalance = await ethers.provider.getBalance(accounts[0].address);
            // First Player Enter
            const jackpotPlayer1 = jackpot.connect(accounts[1]);
            await jackpotPlayer1.enterJackpot({ value: jackpotEntrance_min });
            playersStartingBalance[accounts[1].address] = await ethers.provider.getBalance(accounts[1].address);
            // Second Player Enter
            const jackpotPlayer2 = jackpot.connect(accounts[2]);
            const tx = await jackpotPlayer2.enterJackpot({ value: jackpotEntrance_min });
            playersStartingBalance[accounts[2].address] = await ethers.provider.getBalance(accounts[2].address);
            // Get Contract Balance Before
            const txResponse = await tx.wait(1);
            const contractStartingBalance = await ethers.provider.getBalance(jackpot.address);
            console.log('Two players have entered the Game!');
            console.log('Contract Starting Balance: ', contractStartingBalance.toString());
          });
        });
      });
    });
