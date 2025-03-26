import { HttpService } from '@nestjs/axios';
import { Injectable, Logger } from '@nestjs/common';
import { CommonService } from './common-service';
import { ZillowUrlsDto } from './dto/zillow-urls.dto';
import { firstValueFrom } from 'rxjs';
import { HttpsProxyAgent } from 'https-proxy-agent';

@Injectable()
export class ScrapperService {
  private readonly logger = new Logger(ScrapperService.name);

  constructor(
    private readonly httpService: HttpService,
    private readonly commonService: CommonService,
  ) {}

  // THIS EXECUTE FIRST! MAIN ONE
  async runScrapper() {
    // Retrieve the array of ZillowData objects (each containing a countyId and a zillowLink)
    const zillowData: ZillowUrlsDto[] = await this.getZillowUrls();

    // Process each Zillow URL
    for (const item of zillowData) {
      await this.executeScrapper(item.zillowLink, item.countyId);

      // Generate a random delay between 5000ms (5s) and 25000ms (25s)
      const randomDelay = Math.floor(Math.random() * (25000 - 5000 + 1)) + 5000;
      await new Promise((resolve) => setTimeout(resolve, randomDelay));
    }
  }

  // THIS EXECUTE INSIDE runScrapper FIRST, to get zillow LINKS
  async getZillowUrls(): Promise<ZillowUrlsDto[]> {
    const url = 'https://api.moverlead.com/api/scrapper/get-zillow-urls';
    const headers = { accept: '*/*' };

    const response = await firstValueFrom(
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call,@typescript-eslint/no-unsafe-member-access
      this.httpService.post<ZillowUrlsDto[]>(url, '', { headers }),
    );
    console.log(response.data);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return
    return response.data;
  }

  // THIS EXECUTE INSIDE runScrapper for loop!
  async executeScrapper(zillowLink: string, countyId: string) {
    const key: string = await this.generateRandomKey();

    await this.startedScrapperDynamo(key, countyId, zillowLink);

    // define input data from zillow link
    const inputData = await this.commonService.defineInputData(zillowLink);

    // Define headers for the Zillow request
    const headers = await this.commonService.defineHeaders();

    try {
      // Build the BrightData proxy URL using the provided details.
      // Using the format: username:password@host:port
      const proxyUrl =
        'http://brd-customer-hl_104fb85c-zone-datacenter_proxy1:6yt7rqg6ryxk@brd.superproxy.io:33335';

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

      await this.commonService.uploadResults(results, countyId, key);
      await this.commonService.successfulScrapper(key);
      console.log(`Successful scrapper for: ${key}`);

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
    console.log(`Processed countyId: ${countyId}`);
  }

  private async startedScrapperDynamo(
    key: string,
    countyId: string,
    zillowUrl: string,
  ): Promise<void> {
    try {
      const axiosConfig: any = {
        headers: {
          accept: '*/*',
          'Content-Type': 'application/json',
        },
      };

      const payload = {
        key: key,
        countyId: countyId,
        zillowUrl: zillowUrl,
      };

      const response = await firstValueFrom(
        this.httpService.post(
          'https://api.moverlead.com/api/aws/started-scrapper',
          payload,
          axiosConfig,
        ),
      );

      console.log('Scrapper started successfully:', response.data);
      // Process the response data as needed
    } catch (error: any) {
      console.error('Error starting scrapper:', error);
      // Handle specific error cases if needed
    }
  }

  
  private async generateRandomKey(length: number = 10): Promise<string> {
    const characters =
      'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < length; i++) {
      result += characters.charAt(
        Math.floor(Math.random() * characters.length),
      );
    }

    return `snapshot_${result}.json`;
  }
}
