import { HttpService } from '@nestjs/axios';
import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { firstValueFrom } from 'rxjs';

@Injectable()
export class CommonService {
  private readonly logger = new Logger(CommonService.name);

  constructor(private readonly httpService: HttpService) {}

  async uploadErrorToS3(key: string, countyId: string, errorInfo: any) {
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

  async successfulScrapper(key: string): Promise<string> {
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

  async failedScrapper(key: string): Promise<string> {
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

  async defineInputData(zillowLink: string): Promise<any> {
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

  async defineHeaders() {
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

  async uploadResults(
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
