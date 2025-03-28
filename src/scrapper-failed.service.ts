import { HttpService } from '@nestjs/axios';
import { Injectable, Logger } from '@nestjs/common';
import { GetFailedScrapperDto } from './dto/get-failed-scrapper.dto';
import { CommonService } from './common-service';
import axios from 'axios';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { firstValueFrom } from 'rxjs';

@Injectable()
export class ScrapperFailedService {
  private readonly logger = new Logger(ScrapperFailedService.name);
  constructor(
    private readonly httpService: HttpService,
    private readonly commonService: CommonService,
  ) {}

  // RUN SCRAPPER FOR FAILED ONES
  async runScrapper() {
    // Retrieve the array of ZillowData objects (each containing a countyId and a zillowLink)
    const zillowData: GetFailedScrapperDto[] = await this.getFailedScrapper();

    // Process each Zillow URL
    for (const item of zillowData) {
      await this.executeScrapper(item.zillowUrl, item.countyId, item.s3Key);

      // Generate a random delay between 5000ms (5s) and 25000ms (25s)
      const randomDelay = Math.floor(Math.random() * (25000 - 5000 + 1)) + 5000;
      await new Promise((resolve) => setTimeout(resolve, randomDelay));
    }
  }

  // THIS EXECUTE INSIDE runScrapper for loop!
  async executeScrapper(zillowLink: string, countyId: string, key: string) {
    // define input data from zillow link
    const inputData = await this.commonService.defineInputData(zillowLink);

    // Define headers for the Zillow request
    const headers = await this.commonService.defineHeaders();

    await this.updateAttemptCount(key);
    try {
      // Build the BrightData proxy URL using the provided details.
      // Using the format: username:password@host:port
      //const proxyUrl = 'http://brd-customer-hl_104fb85c-zone-datacenter_proxy1:6yt7rqg6ryxk@brd.superproxy.io:33335';
      const proxyUrl =
        'http://brd-customer-hl_104fb85c-zone-residential_proxy1:qf2a0h0fhx4d@brd.superproxy.io:33335';

      // Create the proxy agent.
      const proxyAgent = new HttpsProxyAgent(proxyUrl);

      // Add the proxy agent to the axios config.
      // Setting "proxy: false" disables axios' default proxy handling,
      // allowing the custom agent to be used.
      const axiosConfig: any = {
        headers,
        httpsAgent: proxyAgent,
        proxy: false,
      };

      const response = await firstValueFrom(
        this.httpService.put(
          'https://www.zillow.com/async-create-search-page-state',
          inputData,
          axiosConfig,
        ),
      );

      const results = response.data?.cat1?.searchResults?.mapResults;

      await this.commonService.successfulScrapper(key, results.length);
      await this.commonService.uploadResults(results, countyId, key);

      // Process the results as needed
    } catch (error) {
      const errorInfo = {
        zillowLink, // the Zillow URL we attempted to scrape
        inputData, // input data sent to Zillow
        headers, // headers used in the request
        errorMessage: error.message, // error message from axios
        errorStack: error.stack, // full error stack trace
        errorResponse: error.response
          ? {
              status: error.response.status, // HTTP status code
              statusText: error.response.statusText, // Status text
              data: error.response.data, // response data from the server
              headers: error.response.headers, // response headers
            }
          : null,
        errorConfig: error.config, // axios config used for the request
        timestamp: new Date().toISOString(), // when the error occurred
      };

      // key, // unique scrapper key
      //   countyId: countyId, // county id used in this attempt
      // handle errorInfo here

      await this.commonService.failedScrapper(key);
      await this.commonService.uploadErrorToS3(key, countyId, errorInfo);
    }

    // Optionally, upload the results using your S3 service (using the countyId for reference)
    // await this.s3service.uploadResults(results, countyId);
    //console.log(`Processed countyId: ${countyId}`);
  }

  private async updateAttemptCount(key: string): Promise<string> {
    // Build the URL using the dynamic key parameter
    const url = `https://api.moverlead.com/api/aws/update-attempt-count/${key}`;

    try {
      // Send a POST request with no request body and accept all responses
      const response = await axios.post(url, '', {
        headers: { accept: '*/*' },
      });

      console.log(
        '🧊 : Count attempt has been updated in DynamoDB for ',
        response.data,
      );
      return response.data;
    } catch (error: any) {
      console.error('Error updating attempt count:', error);
      throw error;
    }
  }

  async getFailedScrapper() {
    const url = 'https://api.moverlead.com/api/snapshots/failed';
    try {
      const response = await axios.get(url, {
        headers: { accept: '*/*' },
      });
      console.log('Check failed scrapper response:', response.data);
      return response.data;
    } catch (error: any) {
      console.error('Error checking failed scrapper:', error);
      throw error;
    }
  }
}
