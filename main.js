const fs = require("fs");
const path = require("path");
const axios = require("axios");
const readline = require("readline");
const printBanner = require("./config/banner");
const logger = require("./config/logger");

class DropstabBot {
  constructor() {
    this.baseURL = "https://api.miniapp.dropstab.com";
    this.userData = null;

    this.globalHeaders = {
      Accept: "application/json",
      "Accept-Encoding": "gzip, deflate, br, zstd",
      "Accept-Language": "en-US,en;q=0.9",
      "Content-Type": "application/json",
      Origin: "https://mdkefiwstepf.dropstab.com",
      Priority: "u=1,i",
      Referer: "https://mdkefiwstepf.dropstab.com/",
      "Sec-Ch-Ua":
        '"Microsoft Edge";v="129", "Not?A?Brand";v="8", "Chromium";v="129", "Microsoft Edge WebView2";v="129"',
      "Sec-Ch-Ua-Mobile": "?0",
      "Sec-Ch-Ua-Platform": '"Windows"',
      "Sec-Fetch-Dest": "empty",
      "Sec-Fetch-Mode": "cors",
      "Sec-Fetch-Site": "same-site",
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36 Edg/129.0.0.0",
    };

    this.api = axios.create({
      baseURL: this.baseURL,
      timeout: 30000,
      maxRedirects: 5,
      headers: this.globalHeaders,
    });

    this.api.interceptors.request.use((request) => {
      logger.debug(`Request Details:`, {
        url: request.url,
        method: request.method,
        data: request.data,
      });
      return request;
    });

    this.api.interceptors.response.use(
      (response) => {
        logger.debug(`Response Details:`, {
          status: response.status,
          data: response.data,
        });
        return response;
      },
      (error) => {
        logger.error(`API Error:`, {
          message: error.message,
          status: error.response?.status,
          data: error.response?.data,
        });
        return Promise.reject(error);
      }
    );
  }

  formatTime(seconds) {
    const hrs = Math.floor(seconds / 3600)
      .toString()
      .padStart(2, "0");
    const mins = Math.floor((seconds % 3600) / 60)
      .toString()
      .padStart(2, "0");
    const secs = (seconds % 60).toString().padStart(2, "0");
    return `${hrs}:${mins}:${secs}`;
  }

  async countdown(seconds) {
    for (let i = seconds; i >= 0; i--) {
      readline.cursorTo(process.stdout, 0);
      process.stdout.write(`Wait ${this.formatTime(i)} to continue the loop`);
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    readline.clearLine(process.stdout, 0);
    readline.cursorTo(process.stdout, 0);
  }

  async retryOperation(operation, maxRetries = 3, delay = 2000) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error) {
        if (attempt === maxRetries) throw error;
        const waitTime = delay * Math.pow(2, attempt - 1);
        logger.warn(
          `Retry attempt ${attempt}/${maxRetries} in ${waitTime / 1000}s`
        );
        await new Promise((resolve) => setTimeout(resolve, waitTime));
      }
    }
  }

  getHeaders(additionalHeaders = {}) {
    return {
      ...this.globalHeaders,
      ...(this.api.defaults.headers.common["Authorization"] && {
        Authorization: this.api.defaults.headers.common["Authorization"],
      }),
      ...additionalHeaders,
    };
  }

  storeUserData(userData) {
    this.userData = {
      id: userData.id,
      tgId: userData.tgId,
      tgUsername: userData.tgUsername,
      preLaunchCheckIn: userData.preLaunchCheckIn,
      usedRefLinkCode: userData.usedRefLinkCode,
      welcomeBonusReceived: userData.welcomeBonusReceived,
      balance: userData.balance,
      chatsChecked: userData.chatsChecked,
    };

    logger.info(`User Data:`, {
      username: this.userData.tgUsername,
      balance: this.userData.balance,
    });
  }

  async login(payload) {
    try {
      const response = await this.api.post(
        "/api/auth/login",
        { webAppData: payload },
        {
          validateStatus: (status) => status < 500,
        }
      );

      if (response.data?.jwt?.access?.token) {
        this.api.defaults.headers.common[
          "Authorization"
        ] = `Bearer ${response.data.jwt.access.token}`;
        this.storeUserData(response.data.user);
        logger.info(`Login successful | Balance: ${this.userData.balance}`);
        return { success: true, data: response.data };
      }

      return { success: false, error: "Invalid response format" };
    } catch (error) {
      logger.error(`Login failed: ${error.message}`);
      return { success: false, error: error.message };
    }
  }

  async claimDailyBonus() {
    try {
      const response = await this.api.post(
        "/api/bonus/dailyBonus",
        {},
        {
          headers: this.getHeaders(),
          timeout: 15000,
        }
      );

      if (response.data?.result) {
        logger.info(
          `Daily bonus claimed | Amount: ${response.data.bonus} | Streak: ${response.data.streaks}`
        );
        return { success: true, data: response.data };
      }

      logger.info("Daily bonus already claimed");
      return { success: false, error: "Already claimed" };
    } catch (error) {
      logger.error(`Daily bonus claim failed: ${error.message}`);
      return { success: false, error: error.message };
    }
  }

  async claimWelcomeBonus() {
    try {
      const response = await this.api.post(
        "/api/bonus/welcomeBonus",
        {},
        {
          headers: this.getHeaders(),
          timeout: 15000,
        }
      );

      if (response.data?.result) {
        logger.info(`Welcome bonus claimed | Amount: ${response.data.bonus}`);
        return { success: true, data: response.data };
      }

      logger.info("Welcome bonus already claimed");
      return { success: false, error: "Already claimed" };
    } catch (error) {
      logger.error(`Welcome bonus claim failed: ${error.message}`);
      return { success: false, error: error.message };
    }
  }

  async getRefLinkStatus() {
    try {
      const response = await this.api.get("/api/refLink", {
        headers: this.getHeaders(),
        timeout: 15000,
        validateStatus: (status) => status === 200 || status === 500,
      });

      if (response.status === 500) {
        throw new Error("Server error while checking referral status");
      }

      return {
        success: true,
        data: response.data,
      };
    } catch (error) {
      logger.error("Error checking referral status:", error.message);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  async hasReferrals() {
    try {
      const refStatus = await this.getRefLinkStatus();
      if (!refStatus.success) {
        return false;
      }

      // Check if user has any referrals
      return refStatus.data?.referrals?.total > 0;
    } catch (error) {
      logger.error("Error checking referrals:", error);
      return false;
    }
  }

  async claimRefLink() {
    try {
      // First check if user has any referrals
      const hasRefs = await this.hasReferrals();
      if (!hasRefs) {
        logger.info("User has no referrals, skipping claim check");
        return {
          success: true,
          data: {
            claimed: false,
            message: "No referrals",
          },
        };
      }

      // Check referral status
      logger.info("Checking referral status...");
      const statusResult = await this.getRefLinkStatus();

      if (!statusResult.success) {
        logger.error("Failed to check referral status:", statusResult.error);
        return statusResult;
      }

      // Get status details
      const availableToClaim = statusResult.data?.availableToClaim || 0;
      const totalReward = statusResult.data?.totalReward || 0;
      const refTotal = statusResult.data?.referrals?.total || 0;

      // Display current status
      logger.info("Referral Status:");
      logger.info(`Total Referrals: ${refTotal}`);
      logger.info(`Available to claim: ${availableToClaim}`);
      logger.info(`Total reward earned: ${totalReward}`);

      // If nothing to claim, return with success but claimed=false
      if (availableToClaim === 0) {
        logger.warn("No referral rewards available to claim at this time");
        return {
          success: true,
          data: {
            claimed: false,
            message: "No rewards available",
            stats: {
              totalRefs: refTotal,
              totalReward: totalReward,
            },
          },
        };
      }

      // If we have rewards to claim, proceed with claim
      logger.info(`Claiming ${availableToClaim} available rewards...`);
      const response = await this.api.post(
        "/api/refLink/claim",
        {},
        {
          headers: this.getHeaders(),
          timeout: 15000,
          validateStatus: (status) => status === 200 || status === 500,
        }
      );

      // Handle server error
      if (response.status === 500) {
        throw new Error("Server error while claiming rewards");
      }

      // Handle successful claim
      if (response.data?.success) {
        logger.info("\nReferral Rewards Claimed Successfully");
        logger.info(`Amount claimed: ${availableToClaim}`);
        logger.info(`New total reward: ${totalReward + availableToClaim}`);

        // Get updated status for verification
        const updatedStatus = await this.getRefLinkStatus();
        if (updatedStatus.success) {
          logger.info("Updated Status After Claim:");
          logger.info(
            `Available to claim: ${updatedStatus.data.availableToClaim}`
          );
          logger.info(`Total reward: ${updatedStatus.data.totalReward}`);
        }

        return {
          success: true,
          data: {
            claimed: true,
            amount: availableToClaim,
            total: totalReward + availableToClaim,
            stats: {
              totalRefs: refTotal,
              totalReward:
                updatedStatus.data?.totalReward ||
                totalReward + availableToClaim,
            },
          },
        };
      }

      // If code reaches here, something unexpected happened
      logger.warn("Claim request completed but rewards were not claimed");
      return {
        success: true,
        data: {
          claimed: false,
          message: "Claim completed but no rewards received",
          stats: {
            totalRefs: refTotal,
            totalReward: totalReward,
          },
        },
      };
    } catch (error) {
      // Only log real errors, not expected conditions
      if (error.message !== "Failed to claim rewards") {
        logger.error("Error in claim process:", error.message);
      }

      // Retry only network errors
      if (error.code === "ECONNRESET" || error.code === "ETIMEDOUT") {
        return await this.retryOperation(() => this.claimRefLink(), 3, 5000);
      }

      return {
        success: false,
        error: error.message,
      };
    }
  }

  async getActiveTasks() {
    try {
      const response = await this.api.get("/api/quest", {
        headers: this.getHeaders(),
        timeout: 15000,
      });

      if (response.data) {
        return { success: true, data: response.data };
      }
      return { success: false, error: "Invalid response" };
    } catch (error) {
      logger.error(`Failed to fetch tasks: ${error.message}`);
      return { success: false, error: error.message };
    }
  }

  async verifyTask(taskId) {
    try {
      const response = await this.api.put(
        `/api/quest/${taskId}/verify`,
        {},
        {
          headers: this.getHeaders(),
          timeout: 15000,
          validateStatus: (status) => [200, 400, 500].includes(status),
        }
      );

      if (response.status === 400) {
        logger.warn(`Task ${taskId} verification rejected`);
        return "FAILED";
      }

      return response.data?.status || "FAILED";
    } catch (error) {
      logger.error(`Task ${taskId} verification error: ${error.message}`);
      return "FAILED";
    }
  }

  async claimTask(taskId) {
    const maxRetries = 3;
    const retryDelay = 2000;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const response = await this.api.put(
          `/api/quest/${taskId}/claim`,
          {},
          {
            headers: this.getHeaders(),
            timeout: 15000,
          }
        );

        if (response.data?.status === "OK") return "OK";
        if (response.data?.code === "QUEST_NOT_COMPLETED")
          return "QUEST_NOT_COMPLETED";

        if (attempt < maxRetries) {
          logger.warn(
            `Task ${taskId} claim attempt ${attempt} failed, retrying...`
          );
          await new Promise((resolve) => setTimeout(resolve, retryDelay));
        }
      } catch (error) {
        logger.error(`Task ${taskId} claim error: ${error.message}`);
        if (attempt < maxRetries) {
          await new Promise((resolve) => setTimeout(resolve, retryDelay));
        } else {
          return "FAILED";
        }
      }
    }
    return "FAILED";
  }

  async processTasks() {
    try {
      const tasksResult = await this.getActiveTasks();
      if (!tasksResult.success) {
        logger.info("No active tasks found");
        return;
      }

      let hasNonInviteTasks = false;
      for (const task of tasksResult.data) {
        if (task.quests) {
          for (const quest of task.quests) {
            if (!quest.name.includes("Invite")) {
              hasNonInviteTasks = true;
              break;
            }
          }
        }
      }

      if (!hasNonInviteTasks) {
        logger.info("Only invite tasks found, skipping");
        return;
      }

      for (const task of tasksResult.data) {
        if (task.quests) {
          for (const quest of task.quests) {
            if (quest.name.includes("Invite")) {
              logger.debug(`Skipping invite task: ${quest.name}`);
              continue;
            }

            if (quest.status === "COMPLETED") {
              logger.debug(`Task already completed: ${quest.name}`);
              continue;
            }

            if (quest.status === "VERIFICATION") {
              logger.debug(`Task in verification: ${quest.name}`);
              continue;
            }

            logger.info(`Processing task: ${quest.name}`);
            const verifyResult = await this.verifyTask(quest.id);

            if (verifyResult === "OK") {
              logger.info(`Task verified: ${quest.name}`);
              await new Promise((resolve) => setTimeout(resolve, 2000));

              const claimResult = await this.claimTask(quest.id);
              switch (claimResult) {
                case "OK":
                  logger.info(`Task claimed successfully: ${quest.name}`);
                  break;
                case "QUEST_NOT_COMPLETED":
                  logger.info(`Task pending verification: ${quest.name}`);
                  break;
                default:
                  logger.warn(`Task claim failed: ${quest.name}`);
              }
            } else {
              logger.error(`Task verification failed: ${quest.name}`);
            }
          }
        }
      }
    } catch (error) {
      logger.error(`Task processing error: ${error.message}`);
    }
  }
  async getCoins() {
    try {
      const response = await this.api.get("/api/order/coins", {
        headers: this.getHeaders(),
        timeout: 15000,
      });

      const activeCoins = response.data.filter((coin) => coin.actual === true);
      logger.info(`Found ${activeCoins.length} active coins`);
      return activeCoins;
    } catch (error) {
      logger.error(`Failed to fetch coins: ${error.message}`);
      if (error.code === "ECONNRESET") {
        return await this.retryOperation(() => this.getCoins(), 3, 5000);
      }
      return null;
    }
  }

  async getCoinStats(coinId) {
    try {
      const response = await this.api.get(`/api/order/coinStats/${coinId}`, {
        headers: this.getHeaders(),
        timeout: 15000,
      });

      if (response.data?.coin) {
        const stats = response.data;
        logger.debug(`Coin Stats:`, {
          total: stats.total,
          shortWin: stats.short,
          longWin: stats.long,
          winsPercent: stats.percentUsersWithWinsPredictions,
          lossesPercent: stats.percentUsersWithLosesPredictions,
        });
        return { success: true, data: stats };
      }
      return { success: false, error: "Invalid response format" };
    } catch (error) {
      logger.error(`Failed to get coin stats: ${error.message}`);
      return { success: false, error: error.message };
    }
  }

  async decideTradingStrategy(coin) {
    try {
      logger.info(`Analyzing ${coin.name} for trading`);
      const statsResult = await this.getCoinStats(coin.id);

      if (!statsResult.success) {
        const defaultStrategy = coin.change24h < 0 ? "SHORT" : "LONG";
        logger.warn(`Using default strategy: ${defaultStrategy}`);
        return defaultStrategy;
      }

      const stats = statsResult.data;
      const shortWinRate = parseFloat(stats.short);
      const longWinRate = parseFloat(stats.long);
      const winPredictions = parseFloat(stats.percentUsersWithWinsPredictions);
      const lossPredictions = parseFloat(
        stats.percentUsersWithLosesPredictions
      );

      let selectedType, reason;

      if (Math.abs(shortWinRate - longWinRate) >= 10) {
        if (shortWinRate > longWinRate) {
          selectedType = "SHORT";
          reason = `Short has better win rate (${shortWinRate}% vs ${longWinRate}%)`;
        } else {
          selectedType = "LONG";
          reason = `Long has better win rate (${longWinRate}% vs ${shortWinRate}%)`;
        }
      } else if (winPredictions > lossPredictions + 10) {
        selectedType = coin.change24h < 0 ? "SHORT" : "LONG";
        reason = `Users predict wins (${winPredictions}% vs ${lossPredictions}%)`;
      } else if (Math.abs(coin.change24h) > 2) {
        selectedType = coin.change24h < 0 ? "SHORT" : "LONG";
        reason = `Strong price trend (${coin.change24h}% change)`;
      } else {
        selectedType = Math.random() > 0.5 ? "SHORT" : "LONG";
        reason = "No strong signals, random choice";
      }

      logger.info(`Strategy for ${coin.name}: ${selectedType} | ${reason}`);
      return selectedType;
    } catch (error) {
      logger.error(`Strategy error: ${error.message}`);
      return coin.change24h < 0 ? "SHORT" : "LONG";
    }
  }

  async createOrder(
    selectedCoin,
    amount,
    periodId,
    attemptedCoins = new Set()
  ) {
    try {
      if (!periodId || !amount || !selectedCoin?.id) {
        logger.error("Missing required parameters for order creation");
        return { success: false, error: "Invalid parameters" };
      }

      if (attemptedCoins.has(selectedCoin.id)) {
        logger.info(`Coin ${selectedCoin.name} already attempted`);
        return { success: false, error: "Coin already attempted" };
      }

      const type = await this.decideTradingStrategy(selectedCoin);
      logger.info(`Creating order:`, {
        coin: selectedCoin.name,
        period: periodId,
        amount: amount,
        type: type,
      });

      const response = await this.api.post(
        "/api/order",
        {
          coinId: selectedCoin.id,
          type,
          amount,
          periodId,
        },
        {
          headers: this.getHeaders(),
          timeout: 15000,
          validateStatus: (status) => [200, 404, 500].includes(status),
        }
      );

      if (response.status === 404) {
        logger.warn(`${selectedCoin.name} not available, trying next coin`);
        attemptedCoins.add(selectedCoin.id);

        const coins = await this.getCoins();
        if (!coins?.length) {
          return { success: false, error: "No coins available" };
        }

        const availableCoins = coins
          .filter((coin) => !attemptedCoins.has(coin.id))
          .sort((a, b) => a.sortOrder - b.sortOrder);

        if (!availableCoins.length) {
          return { success: false, error: "All coins unavailable" };
        }

        return this.createOrder(
          availableCoins[0],
          amount,
          periodId,
          attemptedCoins
        );
      }

      if (response.status === 500) {
        throw new Error("Server error during order creation");
      }

      if (response.data?.periods) {
        const periodData = response.data.periods.find(
          (p) => p.period?.id === parseInt(periodId)
        );

        if (periodData?.order) {
          const order = periodData.order;
          logger.info(`Order created successfully:`, {
            id: order.id,
            status: order.status,
            price: order.priceEntry,
            timeToFinish: order.secondsToFinish,
          });

          return {
            success: true,
            data: response.data,
            orderDetails: {
              orderId: order.id,
              periodId,
              type,
              coin: selectedCoin,
              amount,
              status: order.status,
              priceEntry: order.priceEntry,
              secondsToFinish: order.secondsToFinish,
            },
          };
        }
      }

      logger.error("Unexpected order response format");
      return {
        success: false,
        error: "Unexpected response format",
        response: response.data,
      };
    } catch (error) {
      logger.error(`Order creation failed: ${error.message}`);

      if (
        ["ECONNRESET", "ETIMEDOUT"].includes(error.code) ||
        error.response?.status === 500
      ) {
        return await this.retryOperation(
          () =>
            this.createOrder(selectedCoin, amount, periodId, attemptedCoins),
          3,
          5000
        );
      }

      return {
        success: false,
        error: error.message,
        details: error.response?.data,
      };
    }
  }

  async getOrders() {
    try {
      const response = await this.api.get("/api/order", {
        headers: this.getHeaders(),
        timeout: 15000,
      });

      if (response.data?.results) {
        logger.info(`Trading stats:`, {
          score: response.data.totalScore,
          orders: response.data.results.orders,
          wins: response.data.results.wins,
          losses: response.data.results.loses,
          winRate: response.data.results.winRate,
        });
      }

      return response.data;
    } catch (error) {
      logger.error(`Failed to fetch orders: ${error.message}`);
      if (error.code === "ECONNRESET") {
        return await this.retryOperation(() => this.getOrders(), 3, 5000);
      }
      return null;
    }
  }

  async checkActiveOrders() {
    try {
      const orders = await this.getOrders();
      if (!orders) {
        return { periodOrders: {}, orderCount: 0 };
      }

      let periodOrders = {
        1: { hasOrder: false, status: null },
        2: { hasOrder: false, status: null },
        3: { hasOrder: false, status: null },
      };
      let orderCount = 0;

      if (orders.periods) {
        for (const periodData of orders.periods) {
          const periodId = periodData.period.id;

          if (periodData.order) {
            orderCount++;
            const order = periodData.order;

            logger.info(`Period ${periodId} order:`, {
              id: order.id,
              coin: `${order.coin.name} (${order.coin.symbol})`,
              status: order.status,
              type: order.short ? "SHORT" : "LONG",
              entry: order.priceEntry,
              exit: order.priceExit,
            });

            periodOrders[periodId] = {
              hasOrder: true,
              status: order.status,
              order: order,
              periodInfo: periodData.period,
            };
          } else {
            periodOrders[periodId] = {
              hasOrder: false,
              status: null,
              order: null,
              periodInfo: periodData.period,
            };

            logger.info(`Period ${periodId} info:`, {
              threshold: periodData.period.unlockThreshold,
              reward: periodData.period.reward,
            });
          }
        }
      }

      return { periodOrders, orderCount };
    } catch (error) {
      logger.error(`Order check failed: ${error.message}`);
      return { periodOrders: {}, orderCount: 0 };
    }
  }

  async claimOrder(orderId) {
    const claimOperation = async () => {
      try {
        logger.info(`Claiming order: ${orderId}`);
        const response = await this.api.put(
          `/api/order/${orderId}/claim`,
          {},
          {
            headers: this.getHeaders(),
            timeout: 15000,
            validateStatus: (status) => [200, 500].includes(status),
          }
        );

        if (response.status === 500) {
          logger.warn("Server error during claim, retrying in 5s");
          await new Promise((resolve) => setTimeout(resolve, 5000));
          throw new Error("Server error during claim");
        }

        if (response.data?.periods) {
          const claimedOrder = response.data.periods?.find(
            (period) => period.order?.id === orderId
          )?.order;

          if (claimedOrder) {
            logger.info(`Order claimed successfully:`, {
              id: claimedOrder.id,
              coin: `${claimedOrder.coin.name} (${claimedOrder.coin.symbol})`,
              type: claimedOrder.short ? "SHORT" : "LONG",
              entry: claimedOrder.priceEntry,
              exit: claimedOrder.priceExit,
              change: claimedOrder.percentageChange,
              reward: claimedOrder.reward,
            });

            return {
              success: true,
              data: response.data,
              claimedOrder,
            };
          }
        }

        logger.error("Invalid claim response format");
        return {
          success: false,
          error: "Invalid claim response",
        };
      } catch (error) {
        logger.error(`Claim failed: ${error.message}`);
        await new Promise((resolve) => setTimeout(resolve, 5000));

        if (
          ["ECONNRESET", "ETIMEDOUT"].includes(error.code) ||
          error.response?.status === 500
        ) {
          throw error;
        }

        return {
          success: false,
          error: error.message,
        };
      }
    };

    try {
      return await this.retryOperation(claimOperation, 5, 5000);
    } catch (error) {
      logger.error(`Claim failed after all retries: ${error.message}`);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  async processTrading() {
    try {
      logger.info("Starting trading process");

      while (true) {
        try {
          logger.info("Checking orders status");
          let orderCheck = await this.checkActiveOrders();

          for (const [periodId, periodData] of Object.entries(
            orderCheck.periodOrders
          )) {
            logger.info(`Processing period ${periodId}`);

            try {
              const threshold = periodData.periodInfo?.unlockThreshold || 0;
              if (
                threshold > 0 &&
                (!this.userData?.balance || this.userData.balance < threshold)
              ) {
                logger.info(
                  `Period ${periodId} locked (Need balance: ${threshold})`
                );
                continue;
              }

              if (
                periodData.hasOrder &&
                ["PENDING", "ACTIVE"].includes(periodData.status)
              ) {
                logger.info(`Period ${periodId} has active order`);
                continue;
              }

              if (periodData.status === "CLAIM_AVAILABLE") {
                logger.info(`Claiming winning order in period ${periodId}`);
                const claimResult = await this.claimOrder(periodData.order.id);

                await new Promise((resolve) => setTimeout(resolve, 2000));
                orderCheck = await this.checkActiveOrders();

                const updatedPeriodData = orderCheck.periodOrders[periodId];
                if (updatedPeriodData.status !== "CLAIM_AVAILABLE") {
                  logger.info(
                    `Successfully claimed order for period ${periodId}`
                  );
                } else {
                  logger.warn(`Claim pending for period ${periodId}`);
                  continue;
                }
              }

              if (
                !periodData.hasOrder ||
                ["NOT_WIN", "CLAIM_AVAILABLE"].includes(periodData.status)
              ) {
                const currentThreshold =
                  periodData.periodInfo?.unlockThreshold || 0;
                if (
                  currentThreshold > 0 &&
                  (!this.userData?.balance ||
                    this.userData.balance < currentThreshold)
                ) {
                  logger.info(
                    `Period ${periodId} is locked (Need: ${currentThreshold})`
                  );
                  continue;
                }

                const coins = await this.getCoins();
                if (!coins?.length) {
                  logger.warn(`No available coins for period ${periodId}`);
                  continue;
                }

                const reward = periodData.periodInfo?.reward || 250;
                logger.info(`Creating order for period ${periodId}`);

                const orderResult = await this.createOrder(
                  coins[0],
                  reward,
                  parseInt(periodId)
                );

                await new Promise((resolve) => setTimeout(resolve, 2000));
                orderCheck = await this.checkActiveOrders();

                const updatedPeriodData = orderCheck.periodOrders[periodId];
                if (updatedPeriodData.hasOrder) {
                  logger.info(
                    `Order created successfully in period ${periodId}`
                  );
                } else {
                  logger.warn(`Order creation pending for period ${periodId}`);
                }
              }
            } catch (periodError) {
              logger.error(
                `Error in period ${periodId}: ${periodError.message}`
              );
              continue;
            }
          }

          logger.info("Waiting 60s before next cycle");
          await new Promise((resolve) => setTimeout(resolve, 60000));
        } catch (cycleError) {
          logger.error(`Trading cycle error: ${cycleError.message}`);
          await new Promise((resolve) => setTimeout(resolve, 60000));
        }
      }
    } catch (error) {
      logger.error(`Fatal trading error: ${error.message}`);
      if (error.code === "ECONNRESET") {
        logger.warn("Connection reset, restarting in 10s");
        await new Promise((resolve) => setTimeout(resolve, 10000));
        return this.processTrading();
      }
      throw error;
    }
  }

  async processAccount(payload) {
    try {
      logger.info("Processing account");
      const loginResult = await this.login(payload);

      if (!loginResult.success) {
        logger.error("Login failed, skipping account");
        return;
      }

      // Claim bonuses
      await this.claimWelcomeBonus();
      await this.claimDailyBonus();
      await this.claimRefLink();

      // Process tasks first
      logger.info("Starting task processing...");
      await this.processTasks();

      // Process single trading cycle instead of infinite loop
      logger.info("Starting trading process");
      await this.processTradingCycle();

      logger.info("Account processing completed");
    } catch (error) {
      logger.error(`Account processing error: ${error.message}`);
    }
  }

  // New method for single trading cycle
  async processTradingCycle() {
    try {
      logger.info("Checking orders status");
      let orderCheck = await this.checkActiveOrders();

      for (const [periodId, periodData] of Object.entries(
        orderCheck.periodOrders
      )) {
        logger.info(`Processing period ${periodId}`);

        try {
          const threshold = periodData.periodInfo?.unlockThreshold || 0;
          if (
            threshold > 0 &&
            (!this.userData?.balance || this.userData.balance < threshold)
          ) {
            logger.info(
              `Period ${periodId} locked (Need balance: ${threshold})`
            );
            continue;
          }

          if (
            periodData.hasOrder &&
            ["PENDING", "ACTIVE"].includes(periodData.status)
          ) {
            logger.info(`Period ${periodId} has active order`);
            continue;
          }

          if (periodData.status === "CLAIM_AVAILABLE") {
            logger.info(`Claiming winning order in period ${periodId}`);
            await this.claimOrder(periodData.order.id);
            await new Promise((resolve) => setTimeout(resolve, 2000));
            orderCheck = await this.checkActiveOrders();
          }

          if (
            !periodData.hasOrder ||
            ["NOT_WIN", "CLAIM_AVAILABLE"].includes(periodData.status)
          ) {
            const coins = await this.getCoins();
            if (!coins?.length) {
              logger.warn(`No available coins for period ${periodId}`);
              continue;
            }

            const reward = periodData.periodInfo?.reward || 250;
            logger.info(`Creating order for period ${periodId}`);
            await this.createOrder(coins[0], reward, parseInt(periodId));
            await new Promise((resolve) => setTimeout(resolve, 2000));
          }
        } catch (error) {
          logger.error(`Error in period ${periodId}: ${error.message}`);
          continue;
        }
      }
    } catch (error) {
      logger.error(`Trading cycle error: ${error.message}`);
    }
  }

  async main() {
    printBanner();
    const dataFile = path.join(__dirname, "data.txt");

    try {
      const data = fs
        .readFileSync(dataFile, "utf8")
        .replace(/\r/g, "")
        .split("\n")
        .filter(Boolean);

      logger.info(`Found ${data.length} accounts`);

      while (true) {
        for (let i = 0; i < data.length; i++) {
          const payload = data[i];
          const userData = JSON.parse(
            decodeURIComponent(payload.split("user=")[1].split("&")[0])
          );

          logger.info(
            `Processing account ${i + 1}/${data.length} | ${
              userData.first_name
            }`
          );
          await this.processAccount(payload);

          if (i < data.length - 1) {
            logger.info("Waiting 10 seconds before next account");
            await new Promise((resolve) => setTimeout(resolve, 10000));
          }
        }

        logger.info("All accounts processed, waiting 30 minutes");
        await this.countdown(1800);
      }
    } catch (error) {
      if (error.code === "ENOENT") {
        logger.error("data.txt file not found");
      } else {
        logger.error(`Fatal error: ${error.message}`);
      }
      process.exit(1);
    }
  }
}

// Start the bot
logger.info("Starting Dropstab Bot");
const bot = new DropstabBot();
bot.main().catch((err) => {
  logger.error(`Fatal error: ${err.message}`);
  process.exit(1);
});

module.exports = DropstabBot;
