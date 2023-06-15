// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@chainlink/contracts/src/v0.8/VRFConsumerBaseV2.sol";
import "@chainlink/contracts/src/v0.8/interfaces/VRFCoordinatorV2Interface.sol";
import "@chainlink/contracts/src/v0.8/interfaces/KeeperCompatibleInterface.sol";

// People should fund the contract
// When there are at least two people that have funded the contract, a Countdown will start
// After the countdown, the winner will be picked. The more eth a user has entered, the higher his chances to win
// There should be a max and a min amount of eth that someone can enter with
// When a winner is picked, the winner should be payed 95% of the contracts balance
// The remaining 5% balance will be send to the smart contracts creator address

// Errors
error Jackpot_NotEnoughEthEntered();
error Jackpot_TooMuchEthEntered();
error Jackpot_NotOpen();
error Jackpot_UpkeepNotNeeded(uint256 currentBalance, uint256 numPlayers, uint256 raffleState);
error Jackpot__NoWinnerFound(uint256 randomWord);
error Jackpot_TansferToWinnerFailed(address winner, uint256 winAmount);
error Jackpot_TansferToOwnerFailed(uint256 feeAmount);

contract Jackpot is VRFConsumerBaseV2, KeeperCompatibleInterface {
    // Type declaration
    enum GameState {
        WAITING,
        OPEN,
        CALCULATING
    }

    // Jackpot Variables
    // constants
    uint32 private constant RANDOM_WORDS = 1;
    uint16 private constant REQUEST_CONFIRMATIONS = 3;

    // VRF Variables
    VRFCoordinatorV2Interface private immutable i_vrfCoordinator;
    bytes32 private immutable i_gasLane;
    uint64 private immutable i_subscriptionId;
    uint32 private immutable i_callbackGasLimit;
    // Immutabels
    address payable private i_owner; // the address of the contract creator (immutable)
    uint256 private immutable i_entranceFee_min; // The min amount for entering the jackpot game
    uint256 private immutable i_entranceFee_max; // the max amount for entering the jackpot game
    uint32 private i_winRate; // the win amount percentage (0-100) (immutable)
    uint256 private i_gameTime; // the time amount that starts after two players have entered the jackpot (immutable)
    // Storage Variables
    address payable[] private s_players;
    mapping(address => uint256) private s_addressToAmount; // the player addresses as a mapping with the amount of eth they funded (state)
    GameState private s_gameState; // If the jackpot is open for entries or not (state)
    uint256 private s_gameStartTimeStamp; // the timestamp when the second player has entered the jackpot
    address private s_recentWinnerAddress; // The last winner of the jackpot (state)
    uint256 private s_recentWinnerAmount; // Last winner Jackpot Amount
    uint256 private s_recentWinnerEntry; // Last winner Jackpot entry amount to calculate his earnings in percent ("550% WIN!")

    // Events
    event JackpotEnter(address indexed player, uint256 amount);
    event RequestedJackpotWinner(uint256 indexed requestId);
    event WinnerPicked(
        address indexed winner,
        uint256 indexed rndNumber,
        uint256 indexed indexOfWinningBalance,
        uint256 contractStartingBalance
    );
    event GameFeeTransfered(uint256 amount);

    constructor(
        address vrfCoordinatorV2,
        bytes32 gasLane,
        uint64 subscriptionId,
        uint32 callbackGasLimit,
        uint256 entranceFee_min,
        uint256 entranceFee_max,
        uint32 winRate,
        uint256 gameTime
    ) VRFConsumerBaseV2(vrfCoordinatorV2) {
        // Set VRF Variables
        i_vrfCoordinator = VRFCoordinatorV2Interface(vrfCoordinatorV2);
        i_gasLane = gasLane;
        i_subscriptionId = subscriptionId;
        i_callbackGasLimit = callbackGasLimit;
        // Set Game Immutables
        i_owner = payable(msg.sender);
        i_entranceFee_min = entranceFee_min;
        i_entranceFee_max = entranceFee_max;
        i_winRate = winRate;
        i_gameTime = gameTime;
        // Set Stage Variables
        s_gameState = GameState.WAITING;
        s_gameStartTimeStamp = block.timestamp;
    }

    function enterJackpot() public payable {
        if (msg.value < i_entranceFee_min) {
            revert Jackpot_NotEnoughEthEntered();
        }
        uint256 entranceAmount = s_addressToAmount[msg.sender] + msg.value;
        if (entranceAmount > i_entranceFee_max) {
            revert Jackpot_TooMuchEthEntered();
        }
        if (s_gameState == GameState.CALCULATING) {
            revert Jackpot_NotOpen();
        }

        // Player can enter the Jackpot!
        if (s_addressToAmount[msg.sender] == 0) {
            s_players.push(payable(msg.sender));
        }
        s_addressToAmount[msg.sender] = entranceAmount;

        // Change the state of the game from waiting to open, if there is more then one player
        if (s_gameState == GameState.WAITING && s_players.length > 1) {
            s_gameStartTimeStamp = block.timestamp;
            s_gameState = GameState.OPEN;
        }

        emit JackpotEnter(msg.sender, entranceAmount);
    }

    // checkUpkeep should check, if perform upkeep should be performed, because two players have entered the game
    function checkUpkeep(
        bytes memory checkData
    ) public override returns (bool upkeepNeeded, bytes memory /*performData*/) {
        bool isOpen = (s_gameState == GameState.OPEN);
        bool timePassed = (block.timestamp - s_gameStartTimeStamp) > i_gameTime;
        bool hasPlayers = (s_players.length > 1);
        bool hasBalance = address(this).balance >= (i_entranceFee_min * 2);

        upkeepNeeded = (isOpen && timePassed && hasPlayers && hasBalance);
    }

    // perform Upkeep is the function that will be called, when checkUpkeep has turned true
    function performUpkeep(bytes calldata /* performData */) external override {
        (bool upkeepNeeded, ) = checkUpkeep("");
        if (!upkeepNeeded) {
            revert Jackpot_UpkeepNotNeeded(address(this).balance, s_players.length, uint256(s_gameState));
        }
        // Jackpot closed!
        s_gameState = GameState.CALCULATING;

        // Request Random Number
        uint256 requestId = i_vrfCoordinator.requestRandomWords(
            i_gasLane,
            i_subscriptionId,
            REQUEST_CONFIRMATIONS,
            i_callbackGasLimit,
            RANDOM_WORDS
        );

        emit RequestedJackpotWinner(requestId);
    }

    function fulfillRandomWords(uint256 /* requestId */, uint256[] memory randomWords) internal override {
        uint256 contractStartingBalance = address(this).balance;
        uint256 indexOfWinningBalance = randomWords[0] % contractStartingBalance;
        uint256 getWinningBalance = 0;
        bool foundWinner = false;
        uint256 indexOfWinner = 0;
        for (uint256 i = 0; i < s_players.length; i++) {
            getWinningBalance += s_addressToAmount[s_players[i]];
            if (indexOfWinningBalance <= getWinningBalance) {
                indexOfWinner = i;
                foundWinner = true;
                break;
            }
        }
        if (!foundWinner) {
            revert Jackpot__NoWinnerFound(randomWords[0]);
        }
        // Winner found!
        address payable winner = s_players[indexOfWinner];
        uint256 winningAmount = (address(this).balance * i_winRate) / 100;

        // Set Winner in storage
        s_recentWinnerAddress = winner;
        s_recentWinnerEntry = s_addressToAmount[winner];
        s_recentWinnerAmount = winningAmount;
        // Reset Game
        s_gameState = GameState.WAITING;
        for (uint256 i = 0; i < s_players.length; i++) {
            s_addressToAmount[s_players[i]] = 0;
        }
        s_players = new address payable[](0);
        s_gameStartTimeStamp = block.timestamp;
        (bool success, ) = winner.call{value: winningAmount}("");
        if (!success) {
            revert Jackpot_TansferToWinnerFailed(winner, winningAmount);
        }
        emit WinnerPicked(winner, randomWords[0], indexOfWinningBalance, contractStartingBalance);

        uint256 gameFee = address(this).balance;
        (bool successFee, ) = i_owner.call{value: address(this).balance}("");
        if (!successFee) {
            revert Jackpot_TansferToOwnerFailed(gameFee);
        }
        emit GameFeeTransfered(gameFee);
    }

    // View / Pure Functions
    function getOwner() public view returns (address) {
        return i_owner;
    }

    function getEntranceFeeMin() public view returns (uint256) {
        return i_entranceFee_min;
    }

    function getEntranceFeeMax() public view returns (uint256) {
        return i_entranceFee_max;
    }

    function getWinRate() public view returns (uint32) {
        return i_winRate;
    }

    function getGameTime() public view returns (uint256) {
        return i_gameTime;
    }

    function getGameState() public view returns (GameState) {
        return s_gameState;
    }

    function getAddressToAmount(address player) public view returns (uint256) {
        return s_addressToAmount[player];
    }

    function getPlayersAmount() public view returns (uint256) {
        return s_players.length;
    }

    function getPlayerAtIndex(uint256 index) public view returns (address) {
        return s_players[index];
    }

    function getGameStartTimeStamp() public view returns (uint256) {
        return s_gameStartTimeStamp;
    }

    function getRecentWinner() public view returns (address) {
        return s_recentWinnerAddress;
    }

    function getRecentWinnerAmount() public view returns (uint256) {
        return s_recentWinnerAmount;
    }

    function getRecentWinnerEntry() public view returns (uint256) {
        return s_recentWinnerEntry;
    }
}
