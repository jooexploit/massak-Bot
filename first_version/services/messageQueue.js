/**
 * Message Queue Service
 * Handles queuing and processing of WhatsApp messages to prevent API overload
 */

class MessageQueue {
  constructor() {
    this.queue = [];
    this.processing = false;
    this.maxConcurrent = 3; // Process multiple messages concurrently
    this.delayBetweenMessages = 1000; // Short delay to balance throughput and API safety
    this.activeProcessing = 0;
    this.stats = {
      totalQueued: 0,
      totalProcessed: 0,
      totalFailed: 0,
      currentQueueSize: 0,
    };
  }

  /**
   * Add a message to the queue
   * @param {Object} messageData - Message data to process
   * @param {Function} processor - Function to process the message
   * @returns {Promise} Promise that resolves when message is processed
   */
  add(messageData, processor) {
    return new Promise((resolve, reject) => {
      const queueItem = {
        id: `queue_${Date.now()}_${Math.floor(Math.random() * 10000)}`,
        messageData,
        processor,
        resolve,
        reject,
        addedAt: Date.now(),
        attempts: 0,
        maxAttempts: 3,
      };

      this.queue.push(queueItem);
      this.stats.totalQueued++;
      this.stats.currentQueueSize = this.queue.length;

      console.log(
        `📥 Message queued: ${queueItem.id} | Queue size: ${this.queue.length}`,
      );

      // Start processing if not already running
      if (!this.processing) {
        this.processQueue();
      }
    });
  }

  /**
   * Process messages in the queue
   */
  async processQueue() {
    if (this.processing) return;
    this.processing = true;

    console.log("🔄 Queue processor started");

    while (this.queue.length > 0) {
      // Check if we can process more messages
      if (this.activeProcessing >= this.maxConcurrent) {
        await this.sleep(500);
        continue;
      }

      const item = this.queue.shift();
      this.stats.currentQueueSize = this.queue.length;

      if (!item) continue;

      // Process the message
      this.activeProcessing++;
      this.processItem(item)
        .then(() => {
          this.activeProcessing--;
        })
        .catch(() => {
          this.activeProcessing--;
        });

      // Wait between messages to prevent API overload
      if (this.queue.length > 0) {
        await this.sleep(this.delayBetweenMessages);
      }
    }

    this.processing = false;
    console.log("✅ Queue processor finished - Queue is empty");
  }

  /**
   * Process a single queue item
   * @param {Object} item - Queue item to process
   */
  async processItem(item) {
    const startTime = Date.now();
    console.log(
      `⚙️ Processing message: ${item.id} (Attempt ${item.attempts + 1}/${
        item.maxAttempts
      })`,
    );

    try {
      item.attempts++;

      // Execute the processor function
      const result = await item.processor(item.messageData);

      const duration = Date.now() - startTime;
      console.log(
        `✅ Message processed successfully: ${item.id} (${duration}ms)`,
      );

      this.stats.totalProcessed++;
      item.resolve(result);
    } catch (error) {
      const duration = Date.now() - startTime;
      console.error(
        `❌ Error processing message: ${item.id} (${duration}ms)`,
        error.message,
      );

      // Retry if attempts remaining
      if (item.attempts < item.maxAttempts) {
        console.log(
          `🔄 Retrying message: ${item.id} (${item.attempts}/${item.maxAttempts})`,
        );

        // Add back to queue with exponential backoff
        const retryDelay = Math.pow(2, item.attempts) * 1000; // 2s, 4s, 8s
        await this.sleep(retryDelay);

        this.queue.push(item);
        this.stats.currentQueueSize = this.queue.length;
      } else {
        console.error(
          `💀 Message failed after ${item.maxAttempts} attempts: ${item.id}`,
        );
        this.stats.totalFailed++;
        item.reject(error);
      }
    }
  }

  /**
   * Sleep utility
   * @param {number} ms - Milliseconds to sleep
   */
  sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Get queue statistics
   * @returns {Object} Queue statistics
   */
  getStats() {
    return {
      ...this.stats,
      currentQueueSize: this.queue.length,
      processing: this.processing,
      activeProcessing: this.activeProcessing,
      maxConcurrent: this.maxConcurrent,
      delayBetweenMessages: this.delayBetweenMessages,
    };
  }

  /**
   * Clear the queue (use with caution)
   */
  clear() {
    const cleared = this.queue.length;
    this.queue = [];
    this.stats.currentQueueSize = 0;
    console.log(`🗑️ Queue cleared: ${cleared} messages removed`);
    return cleared;
  }

  /**
   * Set configuration
   * @param {Object} config - Configuration options
   */
  setConfig(config) {
    if (config.maxConcurrent !== undefined) {
      this.maxConcurrent = config.maxConcurrent;
      console.log(`⚙️ Max concurrent messages set to: ${this.maxConcurrent}`);
    }
    if (config.delayBetweenMessages !== undefined) {
      this.delayBetweenMessages = config.delayBetweenMessages;
      console.log(
        `⚙️ Delay between messages set to: ${this.delayBetweenMessages}ms`,
      );
    }
  }
}

// Export singleton instance
const messageQueue = new MessageQueue();
module.exports = messageQueue;
