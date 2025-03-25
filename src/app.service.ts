import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { ZillowUrlsDto } from './dto/zillow-urls.dto';
import axios from 'axios';
import { HttpsProxyAgent } from 'https-proxy-agent';

@Injectable()
export class AppService {
  private readonly logger = new Logger(AppService.name);

  constructor(private readonly httpService: HttpService) {}

  // RUN SCRAPPER FOR FAILED ONES
  async runScrapperFailed() {
    // Retrieve the array of ZillowData objects (each containing a countyId and a zillowLink)
    const zillowData: ZillowUrlsDto[] = await this.getFailedScrapper();

    // Process each Zillow URL
    for (const item of zillowData) {
      await this.executeScrapper(item.zillowLink, item.countyId);

      // Generate a random delay between 5000ms (5s) and 25000ms (25s)
      const randomDelay = Math.floor(Math.random() * (25000 - 5000 + 1)) + 5000;
      await new Promise((resolve) => setTimeout(resolve, randomDelay));
    }
  }


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
    const inputData = await this.defineInputData(zillowLink);

    // Define headers for the Zillow request
    const headers = await this.defineHeaders();

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

      await this.uploadResults(results, countyId, key);
      await this.successfulScrapper(key);
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

      await this.failedScrapper(key);
      await this.uploadErrorToS3(key, countyId, error);
    }

    // Optionally, upload the results using your S3 service (using the countyId for reference)
    // await this.s3service.uploadResults(results, countyId);
    console.log(`Processed countyId: ${countyId}`);
  }

  private async uploadErrorToS3(key: string, countyId: string, errorInfo: any) {
    try {
      const axiosConfig: any = {
        headers: {
          accept: '*/*',
          'Content-Type': 'application/json',
        },
      };

      // Use safeStringify to convert errorInfo into a JSON string without circular references
      const safeErrorInfo = this.safeStringify(errorInfo);

      const payload = {
        key: key,
        countyId: countyId,
        error: safeErrorInfo,
      };

      const response = await firstValueFrom(
        this.httpService.post(
          'https://api.moverlead.com/api/aws/scrapping-error',
          payload,
          axiosConfig,
        ),
      );

      // await this.updateAttemptCount(key);
      console.log('Error has been noted in DynamoDB:', response.data);
      // Process the response data as needed
    } catch (error: any) {
      console.error('Error starting scrapper:', error);
      // Handle specific error cases if needed
    }
  }

  private async successfulScrapper(key: string): Promise<string> {
    // Build the URL using the dynamic key parameter
    const url = `https://api.moverlead.com/api/aws/successful-scrapper/${key}`;

    try {
      // Send a POST request with no request body and accept all responses
      const response = await axios.post(url, '', {
        headers: { accept: '*/*' },
      });

      console.log('Attempt count updated successfully:', response.data);
      return response.data;
    } catch (error: any) {
      console.error('Error updating attempt count:', error);
      throw error;
    }
  }

  private async failedScrapper(key: string): Promise<string> {
    // Build the URL using the dynamic key parameter
    const url = `https://api.moverlead.com/api/aws/failed-scrapper/${key}`;

    try {
      // Send a POST request with no request body and accept all responses
      const response = await axios.post(url, '', {
        headers: { accept: '*/*' },
      });

      console.log('Attempt count updated successfully:', response.data);
      return response.data;
    } catch (error: any) {
      console.error('Error updating attempt count:', error);
      throw error;
    }
  }

  async getFailedScrapper(): Promise<string> {
    const url = 'https://api.moverlead.com/api/aws/check-failed-scrapper';
    try {
      const response = await axios.post(url, '', {
        headers: { accept: '*/*' },
      });
      console.log('Check failed scrapper response:', response.data);
      return response.data;
    } catch (error: any) {
      console.error('Error checking failed scrapper:', error);
      throw error;
    }
  }


  private async updateAttemptCount(key: string): Promise<string> {
    // Build the URL using the dynamic key parameter
    const url = `https://api.moverlead.com/api/aws/update-attempt-count/${key}`;

    try {
      // Send a POST request with no request body and accept all responses
      const response = await axios.post(url, '', {
        headers: { accept: '*/*' },
      });

      console.log('Attempt count updated successfully:', response.data);
      return response.data;
    } catch (error: any) {
      console.error('Error updating attempt count:', error);
      throw error;
    }
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

  private async defineInputData(zillowLink: string): Promise<any> {
    // Clean up and parse the URL
    const cleanedUrl = zillowLink.trim();
    const parsedUrl = new URL(cleanedUrl);

    // Extract the URL parameter that contains the Zillow search state
    const searchQueryStateEncoded =
      parsedUrl.searchParams.get('searchQueryState');
    if (!searchQueryStateEncoded) {
      throw new Error('No searchQueryState parameter found in the URL.');
    }
    const searchQueryStateJson = decodeURIComponent(searchQueryStateEncoded);
    const searchQueryState = JSON.parse(searchQueryStateJson);

    // Extract map bounds, zoom, search term, region selection, and filter state
    const { west, east, south, north } = searchQueryState.mapBounds;
    const zoomValue = searchQueryState.mapZoom;
    const searchValue = searchQueryState.usersSearchTerm;
    const regionSelection = searchQueryState.regionSelection;
    const filterState = searchQueryState.filterState;

    // Map filter values with defaults
    const sortSelection = filterState?.sort?.value ?? '';
    const isNewConstruction = filterState?.nc?.value ?? true;
    const isAuction = filterState?.auc?.value ?? true;
    const isForeclosure = filterState?.fore?.value ?? true;
    const isPending = filterState?.pnd?.value ?? true;
    const isComingSoon = filterState?.cmsn?.value ?? true;
    const daysOnZillow = filterState?.doz?.value ?? '1';
    const isTownhome = filterState?.tow?.value ?? true;
    const isMultiFamily = filterState?.mf?.value ?? true;
    const isCondo = filterState?.con?.value ?? true;
    const isLotOrLand = filterState?.land?.value ?? true;
    const isApartment = filterState?.apa?.value ?? true;
    const isManufactured = filterState?.manu?.value ?? true;
    const isApartmentOrCondo = filterState?.apco?.value ?? true;
    const isPreForeclosure = filterState?.pf?.value ?? false;
    const isForeclosed = filterState?.pmf?.value ?? false;

    // Extract price range (default: min = 0, max = no limit)
    const priceFilter = filterState?.price || {};
    const minPrice = priceFilter.min ?? 0;
    const maxPrice = priceFilter.max ?? null;

    // Build the payload matching Zillow’s expected input
    return {
      searchQueryState: {
        pagination: {},
        isMapVisible: true,
        isListVisible: true,
        mapBounds: { west, east, south, north },
        mapZoom: zoomValue,
        usersSearchTerm: searchValue,
        regionSelection,
        filterState: {
          sortSelection: { value: sortSelection },
          isNewConstruction: { value: isNewConstruction },
          isAuction: { value: isAuction },
          isForSaleForeclosure: { value: isForeclosure },
          isPendingListingsSelected: { value: isPending },
          isComingSoon: { value: isComingSoon },
          doz: { value: daysOnZillow },
          isTownhome: { value: isTownhome },
          isMultiFamily: { value: isMultiFamily },
          isCondo: { value: isCondo },
          isLotLand: { value: isLotOrLand },
          isApartment: { value: isApartment },
          isManufactured: { value: isManufactured },
          isApartmentOrCondo: { value: isApartmentOrCondo },
          isPreForeclosure: { value: isPreForeclosure },
          isForeclosed: { value: isForeclosed },
          price: { min: minPrice, max: maxPrice },
        },
      },
      wants: { cat1: ['mapResults'] },
      requestId: 2,
      isDebugRequest: false,
    };
  }

  private async defineHeaders() {
    // Define headers for the Zillow request
    return {
      Accept: '*/*',
      'Accept-Language': 'en',
      'Content-Type': 'application/json',
      Cookie:
        'optimizelyEndUserId=oeu1728942965854r0.5582628003642129; zguid=24|%247598cf9f-bf14-4479-928b-578a478beb48; ...',
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
      Origin: 'https://www.zillow.com',
    };
  }

  private async defineHeaders2(): Promise<{ [key: string]: string }> {
    const headersList = [
      {
        Accept: '*/*',
        'Accept-Language': 'en',
        'Content-Type': 'application/json',
        Cookie: 'session=abc123; optimizelyEndUserId=oeu1728...',
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/90.0.4430.93 Safari/537.36',
        Origin: 'https://www.zillow.com',
      },
      {
        Accept: 'application/json',
        'Accept-Language': 'en-US,en;q=0.9',
        'Content-Type': 'application/json',
        Cookie: 'session=def456; trackingId=xyz456',
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15',
        Origin: 'https://www.zillow.com',
      },
      {
        Accept: '*/*',
        'Accept-Language': 'fr-FR,fr;q=0.9',
        'Content-Type': 'application/json',
        Cookie: 'session=ghi789; optimizelyEndUserId=oeu9876...',
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Firefox/88.0',
        Origin: 'https://www.zillow.com',
      },
      {
        Accept: 'application/json',
        'Accept-Language': 'en-GB,en;q=0.8',
        'Content-Type': 'application/json',
        Cookie: 'session=jkl012; trackingId=abc789',
        'User-Agent':
          'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/91.0.4472.114 Safari/537.36',
        Origin: 'https://www.zillow.com',
      },
      {
        Accept: '*/*',
        'Accept-Language': 'es-ES,es;q=0.8',
        'Content-Type': 'application/json',
        Cookie: 'session=mno345; optimizelyEndUserId=oeu3456...',
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Edge/91.0.864.48',
        Origin: 'https://www.zillow.com',
      },
      // ... add additional header objects until you have at least 25
      {
        Accept: '*/*',
        'Accept-Language': 'de-DE,de;q=0.9',
        'Content-Type': 'application/json',
        Cookie: 'session=pqr678; optimizelyEndUserId=oeu6789...',
        'User-Agent':
          'Mozilla/5.0 (Windows NT 6.1; Win64; x64) AppleWebKit/537.36 Chrome/92.0.4515.159 Safari/537.36',
        Origin: 'https://www.zillow.com',
      },
      {
        Accept: 'application/json',
        'Accept-Language': 'it-IT,it;q=0.8',
        'Content-Type': 'application/json',
        Cookie: 'session=stu901; trackingId=def123',
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_14_6) AppleWebKit/605.1.15 Version/14.0.3 Safari/605.1.15',
        Origin: 'https://www.zillow.com',
      },
      {
        Accept: '*/*',
        'Accept-Language': 'nl-NL,nl;q=0.9',
        'Content-Type': 'application/json',
        Cookie: 'session=vwx234; optimizelyEndUserId=oeu2345...',
        'User-Agent':
          'Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:90.0) Gecko/20100101 Firefox/90.0',
        Origin: 'https://www.zillow.com',
      },
      {
        Accept: 'application/json',
        'Accept-Language': 'pt-PT,pt;q=0.8',
        'Content-Type': 'application/json',
        Cookie: 'session=yza567; trackingId=ghi456',
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/93.0.4577.63 Safari/537.36',
        Origin: 'https://www.zillow.com',
      },
      {
        Accept: '*/*',
        'Accept-Language': 'ja-JP,ja;q=0.9',
        'Content-Type': 'application/json',
        Cookie: 'session=abc890; optimizelyEndUserId=oeu8901...',
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/94.0.4606.61 Safari/537.36',
        Origin: 'https://www.zillow.com',
      },
      {
        Accept: 'application/json',
        'Accept-Language': 'en-US,en;q=0.8',
        'Content-Type': 'application/json',
        Cookie: 'session=klm345; trackingId=uvw123',
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/96.0.4664.45 Safari/537.36',
        Origin: 'https://www.zillow.com',
      },
      {
        Accept: '*/*',
        'Accept-Language': 'en-CA,en;q=0.9',
        'Content-Type': 'application/json',
        Cookie: 'session=nop678; optimizelyEndUserId=oeu6780',
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 11_0) AppleWebKit/605.1.15 Safari/605.1.15',
        Origin: 'https://www.zillow.com',
      },
      {
        Accept: 'application/json',
        'Accept-Language': 'pt-BR,pt;q=0.9',
        'Content-Type': 'application/json',
        Cookie: 'session=qrstu890; trackingId=xyz890',
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; WOW64) AppleWebKit/537.36 Chrome/97.0.4692.99 Safari/537.36',
        Origin: 'https://www.zillow.com',
      },
      {
        Accept: '*/*',
        'Accept-Language': 'ru-RU,ru;q=0.8',
        'Content-Type': 'application/json',
        Cookie: 'session=wxy123; optimizelyEndUserId=oeu1234',
        'User-Agent':
          'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/98.0.4758.80 Safari/537.36',
        Origin: 'https://www.zillow.com',
      },
      {
        Accept: 'application/json',
        'Accept-Language': 'ar-SA,ar;q=0.9',
        'Content-Type': 'application/json',
        Cookie: 'session=zab456; trackingId=trk456',
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/99.0.4844.51 Safari/537.36',
        Origin: 'https://www.zillow.com',
      },
      {
        Accept: '*/*',
        'Accept-Language': 'ko-KR,ko;q=0.9',
        'Content-Type': 'application/json',
        Cookie: 'session=cde789; optimizelyEndUserId=oeu7890',
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/100.0.4896.75 Safari/537.36',
        Origin: 'https://www.zillow.com',
      },
      {
        Accept: 'application/json',
        'Accept-Language': 'sv-SE,sv;q=0.8',
        'Content-Type': 'application/json',
        Cookie: 'session=efg012; trackingId=trk012',
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_16_0) AppleWebKit/605.1.15 Version/15.1 Safari/605.1.15',
        Origin: 'https://www.zillow.com',
      },
      {
        Accept: '*/*',
        'Accept-Language': 'da-DK,da;q=0.9',
        'Content-Type': 'application/json',
        Cookie: 'session=hij345; optimizelyEndUserId=oeu3457',
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/101.0.4951.41 Safari/537.36',
        Origin: 'https://www.zillow.com',
      },
      {
        Accept: 'application/json',
        'Accept-Language': 'fi-FI,fi;q=0.9',
        'Content-Type': 'application/json',
        Cookie: 'session=klm678; trackingId=trk678',
        'User-Agent':
          'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/102.0.5005.63 Safari/537.36',
        Origin: 'https://www.zillow.com',
      },
      {
        Accept: '*/*',
        'Accept-Language': 'pl-PL,pl;q=0.9',
        'Content-Type': 'application/json',
        Cookie: 'session=nop901; optimizelyEndUserId=oeu9012',
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Firefox/103.0',
        Origin: 'https://www.zillow.com',
      },
      {
        Accept: 'application/json',
        'Accept-Language': 'en-AU,en;q=0.8',
        'Content-Type': 'application/json',
        Cookie: 'session=opq234; trackingId=trk234',
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_16_0) AppleWebKit/605.1.15 Version/15.0 Safari/605.1.15',
        Origin: 'https://www.zillow.com',
      },
      {
        Accept: '*/*',
        'Accept-Language': 'en-IE,en;q=0.9',
        'Content-Type': 'application/json',
        Cookie: 'session=rst567; optimizelyEndUserId=oeu5678',
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/104.0.5112.79 Safari/537.36',
        Origin: 'https://www.zillow.com',
      },
      {
        Accept: 'application/json',
        'Accept-Language': 'cs-CZ,cs;q=0.9',
        'Content-Type': 'application/json',
        Cookie: 'session=tuv890; trackingId=trk890',
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Firefox/105.0',
        Origin: 'https://www.zillow.com',
      },
      {
        Accept: '*/*',
        'Accept-Language': 'he-IL,he;q=0.9',
        'Content-Type': 'application/json',
        Cookie: 'session=wxy123; optimizelyEndUserId=oeu1235',
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/106.0.5249.62 Safari/537.36',
        Origin: 'https://www.zillow.com',
      },
      {
        Accept: 'application/json',
        'Accept-Language': 'tr-TR,tr;q=0.8',
        'Content-Type': 'application/json',
        Cookie: 'session=xyz456; trackingId=trk456',
        'User-Agent':
          'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/107.0.5304.107 Safari/537.36',
        Origin: 'https://www.zillow.com',
      },
      {
        Accept: 'application/json',
        'Accept-Language': 'ru-RU,ru;q=0.8',
        'Content-Type': 'application/json',
        Cookie: 'session=abc111; trackingId=trk111',
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/108.0.0.0 Safari/537.36',
        Origin: 'https://www.zillow.com',
      },
      {
        Accept: 'application/json',
        'Accept-Language': 'sv-SE,sv;q=0.9',
        'Content-Type': 'application/json',
        Cookie: 'session=def222; trackingId=trk222',
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15',
        Origin: 'https://www.zillow.com',
      },
      {
        Accept: '*/*',
        'Accept-Language': 'fi-FI,fi;q=0.9',
        'Content-Type': 'application/json',
        Cookie: 'session=ghi333; trackingId=trk333',
        'User-Agent':
          'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/109.0.0.0 Safari/537.36',
        Origin: 'https://www.zillow.com',
      },
      {
        Accept: 'application/json',
        'Accept-Language': 'pl-PL,pl;q=0.9',
        'Content-Type': 'application/json',
        Cookie: 'session=jkl444; trackingId=trk444',
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Firefox/110.0',
        Origin: 'https://www.zillow.com',
      },
      {
        Accept: '*/*',
        'Accept-Language': 'en-AU,en;q=0.9',
        'Content-Type': 'application/json',
        Cookie: 'session=mno555; trackingId=trk555',
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_16_0) AppleWebKit/605.1.15 Version/15.2 Safari/605.1.15',
        Origin: 'https://www.zillow.com',
      },
      {
        Accept: 'application/json',
        'Accept-Language': 'es-MX,es;q=0.9',
        'Content-Type': 'application/json',
        Cookie: 'session=pqr666; trackingId=trk666',
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/111.0.0.0 Safari/537.36',
        Origin: 'https://www.zillow.com',
      },
      {
        Accept: '*/*',
        'Accept-Language': 'en-CA,en;q=0.9',
        'Content-Type': 'application/json',
        Cookie: 'session=stu777; trackingId=trk777',
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Edge/112.0.0.0',
        Origin: 'https://www.zillow.com',
      },
      {
        Accept: 'application/json',
        'Accept-Language': 'pt-BR,pt;q=0.9',
        'Content-Type': 'application/json',
        Cookie: 'session=vwx888; trackingId=trk888',
        'User-Agent':
          'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/113.0.0.0 Safari/537.36',
        Origin: 'https://www.zillow.com',
      },
      {
        Accept: '*/*',
        'Accept-Language': 'cs-CZ,cs;q=0.9',
        'Content-Type': 'application/json',
        Cookie: 'session=yzA999; trackingId=trk999',
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Firefox/114.0',
        Origin: 'https://www.zillow.com',
      },
      {
        Accept: 'application/json',
        'Accept-Language': 'ro-RO,ro;q=0.9',
        'Content-Type': 'application/json',
        Cookie: 'session=BCD101; trackingId=trk101',
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_16_0) AppleWebKit/605.1.15 Version/15.3 Safari/605.1.15',
        Origin: 'https://www.zillow.com',
      },
      {
        Accept: '*/*',
        'Accept-Language': 'hu-HU,hu;q=0.9',
        'Content-Type': 'application/json',
        Cookie: 'session=EFG202; trackingId=trk202',
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/115.0.0.0 Safari/537.36',
        Origin: 'https://www.zillow.com',
      },
      {
        Accept: 'application/json',
        'Accept-Language': 'he-IL,he;q=0.9',
        'Content-Type': 'application/json',
        Cookie: 'session=HIJ303; trackingId=trk303',
        'User-Agent':
          'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/116.0.0.0 Safari/537.36',
        Origin: 'https://www.zillow.com',
      },
      {
        Accept: '*/*',
        'Accept-Language': 'ar-EG,ar;q=0.9',
        'Content-Type': 'application/json',
        Cookie: 'session=KLM404; trackingId=trk404',
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/117.0.0.0 Safari/537.36',
        Origin: 'https://www.zillow.com',
      },
      {
        Accept: 'application/json',
        'Accept-Language': 'en-NZ,en;q=0.9',
        'Content-Type': 'application/json',
        Cookie: 'session=NOP505; trackingId=trk505',
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15',
        Origin: 'https://www.zillow.com',
      },
      {
        Accept: '*/*',
        'Accept-Language': 'fi-FI,fi;q=0.8',
        'Content-Type': 'application/json',
        Cookie: 'session=QRS606; trackingId=trk606',
        'User-Agent':
          'Mozilla/5.0 (X11; Ubuntu; Linux x86_64) AppleWebKit/537.36 Chrome/118.0.0.0 Safari/537.36',
        Origin: 'https://www.zillow.com',
      },
      {
        Accept: 'application/json',
        'Accept-Language': 'de-AT,de;q=0.9',
        'Content-Type': 'application/json',
        Cookie: 'session=TUV707; trackingId=trk707',
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/119.0.0.0 Safari/537.36',
        Origin: 'https://www.zillow.com',
      },
      {
        Accept: '*/*',
        'Accept-Language': 'es-AR,es;q=0.9',
        'Content-Type': 'application/json',
        Cookie: 'session=WXY808; trackingId=trk808',
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Firefox/120.0',
        Origin: 'https://www.zillow.com',
      },
      {
        Accept: 'application/json',
        'Accept-Language': 'en-IE,en;q=0.9',
        'Content-Type': 'application/json',
        Cookie: 'session=ZAB909; trackingId=trk909',
        'User-Agent':
          'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/121.0.0.0 Safari/537.36',
        Origin: 'https://www.zillow.com',
      },
      {
        Accept: '*/*',
        'Accept-Language': 'fr-CA,fr;q=0.8',
        'Content-Type': 'application/json',
        Cookie: 'session=CDE010; trackingId=trk010',
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/15.4 Safari/605.1.15',
        Origin: 'https://www.zillow.com',
      },
      {
        Accept: 'application/json',
        'Accept-Language': 'it-CH,it;q=0.9',
        'Content-Type': 'application/json',
        Cookie: 'session=FGH111; trackingId=trk1111',
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122.0.0.0 Safari/537.36',
        Origin: 'https://www.zillow.com',
      },
      {
        Accept: '*/*',
        'Accept-Language': 'en-ZA,en;q=0.9',
        'Content-Type': 'application/json',
        Cookie: 'session=IJK212; trackingId=trk212',
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Firefox/123.0',
        Origin: 'https://www.zillow.com',
      },
      {
        Accept: 'application/json',
        'Accept-Language': 'da-DK,da;q=0.9',
        'Content-Type': 'application/json',
        Cookie: 'session=LMN313; trackingId=trk313',
        'User-Agent':
          'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36',
        Origin: 'https://www.zillow.com',
      },

      // ... (continue adding header objects up to at least 25 total)
      // For brevity, you could repeat similar objects with slight modifications.
    ];

    // Randomly select one header object from the array
    const randomIndex = Math.floor(Math.random() * headersList.length);
    return headersList[randomIndex];
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

  private async uploadResults(
    results: any,
    county_id: string,
    key: string,
  ): Promise<string> {
    const axiosConfig: any = {
      headers: {
        accept: '*/*',
        'Content-Type': 'application/json',
      },
    };

    const payload = {
      results, // the results from Zillow (e.g. response.data?.cat1?.searchResults?.mapResults)
      county_id, // the county ID as a string
      key, // the unique key (e.g. "string12345")
    };

    try {
      const response = await firstValueFrom(
        this.httpService.post(
          'https://api.moverlead.com/api/aws/upload-results',
          payload,
          axiosConfig,
        ),
      );
      console.log('Results uploaded successfully:', response.data);
      return response.data;
    } catch (error: any) {
      console.error('Error uploading results:', error);
      throw error;
    }
  }

  private safeStringify(obj: any): string {
    const seen = new WeakSet();
    return JSON.stringify(
      obj,
      (key, value) => {
        if (typeof value === 'object' && value !== null) {
          if (seen.has(value)) {
            return; // Remove circular reference
          }
          seen.add(value);
        }
        return value;
      },
      2,
    );
  }
}
